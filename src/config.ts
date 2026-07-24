import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { OpenVsxPortConfig } from './types.js';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);

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
    source: z
      .object({
        provider: z.literal('openvsx'),
        registryUrl: z.url(),
        extensionId: boundedText(256).regex(
          /^[A-Za-z0-9][A-Za-z0-9-]*\.[A-Za-z0-9][A-Za-z0-9-]*$/u,
        ),
        version: boundedText(128),
        sha256: sha256Schema,
      })
      .strict(),
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
            archive: z
              .object({
                url: z.url(),
                version: boundedText(128),
                sha256: sha256Schema,
              })
              .strict()
              .optional(),
            root: boundedText(1024).optional(),
            entry: boundedText(1024).optional(),
            exclude: z.array(z.string().max(1024)).max(256).optional(),
          })
          .strict()
          .optional(),
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
    throw new Error('The OpenVSX port recipe exceeds 1 MiB.');
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error(
      `The OpenVSX port recipe is not valid JSON: ${message(error)}`,
    );
  }
  const parsed = configSchema.safeParse(decoded);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`The OpenVSX port recipe is invalid: ${issues}`);
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
