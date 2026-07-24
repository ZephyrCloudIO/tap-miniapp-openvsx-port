import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { JsonValue, OpenVsxPortConfig } from './types.js';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const extensionIdSchema = boundedText(256).regex(
  /^[A-Za-z0-9][A-Za-z0-9-]*\.[A-Za-z0-9][A-Za-z0-9-]*$/u,
);

const sourceIdentitySchema = {
  extensionId: extensionIdSchema,
  version: boundedText(128),
  sha256: sha256Schema,
};

const adapterSchema = z
  .object({
    package: boundedText(214),
    version: boundedText(128).regex(
      /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/u,
    ),
    binary: boundedText(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
    args: z.array(z.string().max(4096)).max(64).default([]),
  })
  .strict();

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
const jsonPathSchema = z
  .array(
    boundedText(128).refine(
      (segment) =>
        segment !== '__proto__' &&
        segment !== 'constructor' &&
        segment !== 'prototype',
      { message: 'JSON paths cannot contain prototype mutation segments' },
    ),
  )
  .min(1)
  .max(32);
const bridgeSchema = z
  .object({
    kind: z.literal('vscode-custom-editor'),
    viewType: boundedText(256),
    bootstrap: z
      .object({
        selector: boundedText(1024),
        attribute: boundedText(256),
        encoding: z.literal('base64-json'),
        value: jsonValueSchema.optional(),
      })
      .strict(),
    storage: z
      .object({
        namespace: boundedText(128),
        key: boundedText(512),
        initialValue: jsonValueSchema,
        messageTypePath: jsonPathSchema.optional(),
        messageBindings: z
          .array(
            z
              .object({
                messageType: boundedText(256),
                messageValuePath: jsonPathSchema,
                statePath: jsonPathSchema,
                transform: z
                  .enum(['identity', 'byte-array-to-base64'])
                  .optional(),
              })
              .strict(),
          )
          .max(128),
        bootstrapBindings: z
          .array(
            z
              .object({
                statePath: jsonPathSchema,
                bootstrapPath: jsonPathSchema,
                transform: z
                  .enum(['identity', 'base64-to-byte-array'])
                  .optional(),
              })
              .strict(),
          )
          .max(128),
        vscodeStatePath: jsonPathSchema.optional(),
      })
      .strict()
      .optional(),
    session: z
      .object({
        namespace: boundedText(128),
      })
      .strict()
      .optional(),
    webviewToHostMessages: z.array(boundedText(256)).max(256).optional(),
    hostToWebviewMessages: z.array(boundedText(256)).max(256).optional(),
    requiredHostOperations: z.array(boundedText(256)).max(256).optional(),
  })
  .strict();

const configSchema = z
  .object({
    schemaVersion: z.literal(1),
    converter: z
      .object({
        repository: z.url(),
        package: z.literal('@theaiplatform/openvsx-port'),
        version: boundedText(128),
        binary: z.literal('tap-openvsx'),
        registry: z.literal('https://registry.npmjs.org').optional(),
        access: z.literal('public').optional(),
        packagePage: z.url().optional(),
      })
      .strict()
      .optional(),
    source: z.discriminatedUnion('provider', [
      z
        .object({
          provider: z.literal('openvsx'),
          registryUrl: z.url(),
          ...sourceIdentitySchema,
        })
        .strict(),
      z
        .object({
          provider: z.literal('visualstudio-marketplace'),
          registryUrl: z.literal('https://marketplace.visualstudio.com'),
          ...sourceIdentitySchema,
        })
        .strict(),
    ]),
    conversion: z
      .object({
        profile: z.literal('static-webview'),
        targets: z
          .array(z.enum(['desktop', 'mobile']))
          .min(1)
          .refine((targets) => new Set(targets).size === targets.length, {
            message: 'conversion.targets must be unique',
          }),
        adapter: adapterSchema.optional(),
        webview: z
          .object({
            source: z.literal('extension').optional(),
            archive: z
              .object({
                url: z.url(),
                version: boundedText(128),
                sha256: sha256Schema,
              })
              .strict()
              .optional(),
            assets: z
              .array(
                z
                  .object({
                    url: z.url(),
                    sha256: sha256Schema,
                    path: boundedText(1024),
                  })
                  .strict(),
              )
              .max(256)
              .optional(),
            root: boundedText(1024).optional(),
            entry: boundedText(1024).optional(),
            exclude: z.array(z.string().max(1024)).max(256).optional(),
            rebaseRootPaths: z
              .array(boundedText(256).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u))
              .max(64)
              .optional(),
            replacements: z
              .array(
                z
                  .object({
                    search: boundedText(4096),
                    replace: z.string().max(4096),
                    files: z.array(boundedText(1024)).max(256).optional(),
                  })
                  .strict(),
              )
              .max(256)
              .optional(),
          })
          .strict()
          .superRefine((webview, context) => {
            if (webview.source === 'extension' && webview.archive) {
              context.addIssue({
                code: 'custom',
                message:
                  'conversion.webview cannot declare both source=extension and archive.',
              });
            }
            if (!webview.source && !webview.archive) {
              context.addIssue({
                code: 'custom',
                message:
                  'conversion.webview must declare source=extension or archive.',
              });
            }
          })
          .optional(),
        bridge: bridgeSchema.optional(),
      })
      .catchall(z.unknown()),
    tap: z.record(z.string(), z.unknown()),
    npm: z
      .object({
        name: boundedText(214),
        version: boundedText(128),
        access: z.literal('public'),
        registry: z.literal('https://registry.npmjs.org'),
      })
      .catchall(z.unknown()),
    output: z
      .object({
        workingDirectory: boundedText(2048),
        npmTarball: boundedText(2048),
        compatibilityReport: boundedText(2048),
        attestation: boundedText(2048),
      })
      .strict(),
  })
  .strict();

export interface LoadedPortConfig {
  path: string;
  directory: string;
  value: OpenVsxPortConfig;
}

export async function loadPortConfig(
  configPath: string,
): Promise<LoadedPortConfig> {
  const absolutePath = path.resolve(configPath);
  const bytes = await readFile(absolutePath);
  if (bytes.byteLength > 1024 * 1024) {
    throw new Error('The VS Code extension port recipe exceeds 1 MiB.');
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error(
      `The VS Code extension port recipe is not valid JSON: ${message(error)}`,
    );
  }
  const parsed = configSchema.safeParse(decoded);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`The VS Code extension port recipe is invalid: ${issues}`);
  }
  return {
    path: absolutePath,
    directory: path.dirname(absolutePath),
    value: parsed.data as OpenVsxPortConfig,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
