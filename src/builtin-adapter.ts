import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import { createRslib } from '@rslib/core';
import {
  assembleTapPackage,
  assertPortableTapPackageArtifacts,
  tapLib,
} from '@theaiplatform/miniapp-sdk/rspack';
import { tapVsCodeWebviewRuntimeSource } from '@theaiplatform/miniapp-sdk/vscode-webview';
import type {
  OpenVsxPortConfig,
  VsCodeCustomEditorBridgeConfig,
} from './types.js';

const RUNTIME_FILE_NAME = 'tap-vscode-webview-runtime.js';
const SUPPORTED_HOST_OPERATIONS = new Set([
  'document.read',
  'document.write',
  'storage.get',
  'storage.set',
  'session.get',
  'session.set',
  'session.clear',
  'http.request',
]);

type TapSurfaceRecipe = {
  id: string;
  displayName: string;
  description?: string;
  placement: string;
  scope: string;
  instancePolicy: string;
  persistence: string;
};

type BuiltinAdapterInput = {
  config: OpenVsxPortConfig;
  workingDirectory: string;
  webviewRootDirectory: string;
  outputTarball: string;
};

type ExternalizedWebviewAsset = {
  relativeFile: string;
  source: string;
};

export function canUseBuiltinStaticWebviewAdapter(
  config: OpenVsxPortConfig,
): boolean {
  const bridge = config.conversion.bridge;
  return Boolean(
    config.conversion.webview?.entry &&
      bridge?.kind === 'vscode-custom-editor' &&
      bridge.bootstrap.value !== undefined &&
      (bridge.storage || bridge.session),
  );
}

export async function buildBuiltinStaticWebviewMiniapp({
  config,
  workingDirectory,
  webviewRootDirectory,
  outputTarball,
}: BuiltinAdapterInput): Promise<void> {
  const bridge = requireBuiltinBridge(config);
  const webview = requireBuiltinWebview(config);
  assertSupportedOperations(bridge);
  const generatedRoot = path.join(workingDirectory, 'generated-miniapp');
  const packageOutput = path.join(generatedRoot, 'dist');
  const manifest = createManifest(config, bridge);
  const surfaces = tapSurfaceRecipes(config);
  await rm(generatedRoot, { recursive: true, force: true });
  await mkdir(path.join(generatedRoot, 'src'), { recursive: true });
  await Promise.all([
    writeJson(path.join(generatedRoot, 'manifest.tap.json'), manifest),
    writeFile(
      path.join(generatedRoot, 'src', 'surface.ts'),
      createSurfaceSource(config, bridge),
      'utf8',
    ),
    writeFile(
      path.join(generatedRoot, 'src', 'lifecycle.ts'),
      [
        'export const applicationLifecyclePlugin = Object.freeze({',
        "  name: 'tap-openvsx-static-webview-lifecycle',",
        '  prePause: async () => undefined,',
        '  pause: async () => undefined,',
        '  preResume: async () => undefined,',
        '  resume: async () => undefined,',
        '});',
        'export default applicationLifecyclePlugin;',
        '',
      ].join('\n'),
      'utf8',
    ),
    writeFile(
      path.join(generatedRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: config.npm.name,
          version: config.npm.version,
          description: resolveDescription(config),
          type: 'module',
          files: ['dist', 'README.md'],
          publishConfig: {
            access: config.npm.access,
            registry: config.npm.registry,
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    ),
    writeFile(
      path.join(generatedRoot, 'README.md'),
      createPackageReadme(config),
      'utf8',
    ),
    ...surfaces.map((surface) =>
      writeFile(
        path.join(
          generatedRoot,
          'src',
          `surface-${safeFileSegment(surface.id)}.ts`,
        ),
        "export { default, mount } from './surface';\n",
        'utf8',
      ),
    ),
  ]);

  const targetRoots: Partial<Record<'desktop' | 'mobile', string>> = {};
  for (const target of config.conversion.targets) {
    const targetRoot = path.join(generatedRoot, '.tap-build', target);
    await buildTarget({
      target,
      generatedRoot,
      targetRoot,
      webviewRootDirectory,
      webview,
      manifest,
    });
    targetRoots[target] = targetRoot;
  }
  await assembleTapPackage({
    manifest: path.join(generatedRoot, 'manifest.tap.json'),
    output: packageOutput,
    targets: targetRoots,
  });
  await assertPortableTapPackageArtifacts({
    output: packageOutput,
    forbiddenRoots: [workingDirectory, webviewRootDirectory],
  });
  await packGeneratedPackage(generatedRoot, outputTarball);
}

function requireBuiltinBridge(
  config: OpenVsxPortConfig,
): VsCodeCustomEditorBridgeConfig {
  const bridge = config.conversion.bridge;
  if (
    !canUseBuiltinStaticWebviewAdapter(config) ||
    bridge?.kind !== 'vscode-custom-editor'
  ) {
    throw new Error(
      'The built-in static-webview adapter requires conversion.webview.entry plus a declarative vscode-custom-editor bridge with bootstrap.value and storage or session bindings.',
    );
  }
  return bridge;
}

function requireBuiltinWebview(config: OpenVsxPortConfig): NonNullable<
  OpenVsxPortConfig['conversion']['webview']
> & {
  entry: string;
} {
  const webview = config.conversion.webview;
  if (!webview?.entry) {
    throw new Error(
      'The built-in static-webview adapter requires conversion.webview.entry.',
    );
  }
  return { ...webview, entry: webview.entry };
}

function assertSupportedOperations(
  bridge: VsCodeCustomEditorBridgeConfig,
): void {
  const unsupported = (bridge.requiredHostOperations ?? []).filter(
    (operation) => !SUPPORTED_HOST_OPERATIONS.has(operation),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `The built-in adapter cannot satisfy required host operations: ${unsupported.join(', ')}.`,
    );
  }
}

function requiredRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function tapSurfaceRecipes(config: OpenVsxPortConfig): TapSurfaceRecipe[] {
  const tap = requiredRecord(config.tap, 'tap');
  const surfaces = tap.surfaces;
  if (!Array.isArray(surfaces) || surfaces.length === 0) {
    throw new Error('tap.surfaces must declare at least one surface.');
  }
  return surfaces.map((surface, index) => {
    const label = `tap.surfaces[${String(index)}]`;
    const value = requiredRecord(surface, label);
    return {
      id: requiredString(value.id, `${label}.id`),
      displayName: requiredString(value.displayName, `${label}.displayName`),
      ...(typeof value.description === 'string'
        ? { description: value.description }
        : {}),
      placement: requiredString(value.placement, `${label}.placement`),
      scope: requiredString(value.scope, `${label}.scope`),
      instancePolicy: requiredString(
        value.instancePolicy,
        `${label}.instancePolicy`,
      ),
      persistence: requiredString(value.persistence, `${label}.persistence`),
    };
  });
}

function createManifest(
  config: OpenVsxPortConfig,
  bridge: VsCodeCustomEditorBridgeConfig,
): Record<string, unknown> {
  const tap = requiredRecord(config.tap, 'tap');
  const packageRecipe = requiredRecord(tap.package, 'tap.package');
  const releaseRecipe = requiredRecord(tap.release, 'tap.release');
  const presentationRecipe = requiredRecord(
    tap.presentation,
    'tap.presentation',
  );
  const packageId = requiredString(
    packageRecipe.packageId,
    'tap.package.packageId',
  );
  const namespace = requiredString(
    packageRecipe.namespace,
    'tap.package.namespace',
  );
  const slug = requiredString(packageRecipe.slug, 'tap.package.slug');
  const releaseVersion = requiredString(
    releaseRecipe.version,
    'tap.release.version',
  );
  const surfaces = tapSurfaceRecipes(config);
  const targetExposes: Record<string, { integrity: string; runtime: string }> =
    {
      './tap/lifecycle': { integrity: 'pending', runtime: 'webview' },
    };
  for (const surface of surfaces) {
    targetExposes[exposeForSurface(surface.id)] = {
      integrity: 'pending',
      runtime: 'webview',
    };
  }
  const targetEntries = Object.fromEntries(
    config.conversion.targets.map((target) => [
      target,
      {
        remoteName: federationName(namespace, target),
        remoteEntry: 'remoteEntry.mjs',
        remoteEntryIntegrity: 'pending',
        manifest: 'mf-manifest.json',
        manifestIntegrity: 'pending',
        assetLock: 'tap.package.lock.json',
        assetLockIntegrity: 'pending',
        libraryType: 'module',
        exposes: targetExposes,
      },
    ]),
  );
  const effects: Array<Record<string, unknown>> = [];
  if (bridge.storage) {
    effects.push({
      kind: 'storage',
      resources: [bridge.storage.namespace],
    });
  }
  if (bridge.session) {
    effects.push({ kind: 'credentials', resources: ['package-session'] });
  }
  const networkOrigins = networkOriginsFor(config);
  if (networkOrigins.length > 0) {
    effects.push({ kind: 'host-http', resources: networkOrigins });
  }
  const surfaceContributions: Array<Record<string, unknown>> = surfaces.map(
    (surface) => ({
      kind: 'ui.surface',
      id: surface.id,
      apiVersion: 1,
      targets: Object.fromEntries(
        config.conversion.targets.map((target) => [
          target,
          { expose: exposeForSurface(surface.id), runtime: 'webview' },
        ]),
      ),
      authorization: {
        effects,
      },
      lifecycleScope: 'mount',
      options: {
        displayName: surface.displayName,
        description:
          surface.description ??
          `${surface.displayName} custom editor ported from ${config.source.extensionId} v${config.source.version}.`,
        placement: surface.placement,
        scope: surface.scope,
        instancePolicy: surface.instancePolicy,
        persistence: surface.persistence,
      },
    }),
  );
  const contributions: Array<Record<string, unknown>> = [
    ...surfaceContributions,
    {
      kind: 'miniapp',
      id: slug,
      apiVersion: 1,
      options: { contributionIds: surfaces.map((surface) => surface.id) },
    },
  ];

  const description = resolveDescription(config);
  const presentation = { ...presentationRecipe };
  delete presentation.descriptionTemplate;
  return {
    descriptorVersion: 1,
    package: packageRecipe,
    release: {
      releaseId: `${packageId}@${releaseVersion}`,
      version: releaseVersion,
      contentDigest: 'pending',
    },
    presentation: {
      ...presentation,
      name: requiredString(presentation.name, 'tap.presentation.name'),
      description,
    },
    compatibility: {
      ...requiredRecord(tap.compatibility ?? {}, 'tap.compatibility'),
      tapSdk: '0.3.3',
    },
    targets: targetEntries,
    contributions,
    lifecycle: {
      checkpoint: 'none',
      lifecycleExpose: './tap/lifecycle',
    },
  };
}

function createSurfaceSource(
  config: OpenVsxPortConfig,
  bridge: VsCodeCustomEditorBridgeConfig,
): string {
  const presentation = requiredRecord(
    requiredRecord(config.tap, 'tap').presentation,
    'tap.presentation',
  );
  const webview = requireBuiltinWebview(config);
  const options = {
    title: requiredString(presentation.name, 'tap.presentation.name'),
    entryPath: `webview/${webview.entry}`,
    runtimePath: `webview/${RUNTIME_FILE_NAME}`,
    bootstrap: bridge.bootstrap,
    ...(bridge.storage ? { storage: bridge.storage } : {}),
    ...(bridge.session ? { session: bridge.session } : {}),
    network: { allowedOrigins: networkOriginsFor(config) },
  };
  return [
    "import { mountVsCodeWebview } from '@theaiplatform/miniapp-sdk/vscode-webview';",
    "import type { TapFederatedSurfaceMountContext } from '@theaiplatform/miniapp-sdk/surface';",
    '',
    `const bridgeOptions = ${JSON.stringify(options, null, 2)} as const;`,
    '',
    'export function mount(container: HTMLElement, context: TapFederatedSurfaceMountContext) {',
    '  return mountVsCodeWebview(container, context, bridgeOptions);',
    '}',
    '',
    'export default Object.freeze({ mount });',
    '',
  ].join('\n');
}

async function buildTarget(options: {
  target: 'desktop' | 'mobile';
  generatedRoot: string;
  targetRoot: string;
  webviewRootDirectory: string;
  webview: NonNullable<OpenVsxPortConfig['conversion']['webview']>;
  manifest: Record<string, unknown>;
}): Promise<void> {
  const targets = requiredRecord(options.manifest.targets, 'manifest.targets');
  const target = requiredRecord(
    targets[options.target],
    `manifest.targets.${options.target}`,
  );
  const exposes = requiredRecord(
    target.exposes,
    `manifest.targets.${options.target}.exposes`,
  );
  const library = tapLib({
    manifest: './manifest.tap.json',
    packageTarget: options.target,
    packageOutputRoot: options.targetRoot,
    federation: {
      name: requiredString(target.remoteName, 'target.remoteName'),
      filename: 'remoteEntry.mjs',
      manifest: true,
      library: { type: 'module' },
      dts: false,
      exposes: Object.fromEntries(
        Object.keys(exposes).map((expose) =>
          expose === './tap/lifecycle'
            ? [expose, './src/lifecycle.ts']
            : [
                expose,
                `./src/surface-${safeFileSegment(expose.slice('./ui/'.length))}.ts`,
              ],
        ),
      ),
    },
  });
  library.output = {
    ...library.output,
    assetPrefix: 'auto',
    cleanDistPath: false,
    sourceMap: false,
  };
  library.plugins = [
    ...(library.plugins ?? []),
    emitWebviewAssets(
      options.target,
      options.webviewRootDirectory,
      options.webview,
    ),
  ];
  const rspackTools = library.tools?.rspack;
  if (typeof rspackTools !== 'object' || rspackTools === null) {
    throw new Error('The TAP Rslib configuration did not expose Rspack tools.');
  }
  const bridgeModule = resolveSdkDistModule('vscode-webview.js');
  const surfaceModule = resolveSdkDistModule('surface.js');
  library.tools = {
    ...library.tools,
    rspack: [
      ...(Array.isArray(rspackTools) ? rspackTools : [rspackTools]),
      (config: Rspack.RspackOptions) => ({
        ...config,
        resolve: {
          ...config.resolve,
          alias: {
            ...config.resolve?.alias,
            '@theaiplatform/miniapp-sdk/vscode-webview': bridgeModule,
            '@theaiplatform/miniapp-sdk/surface': surfaceModule,
          },
        },
      }),
    ],
  };
  const rslib = await createRslib({
    cwd: options.generatedRoot,
    config: { lib: [library] },
  });
  await rslib.build();
}

function resolveSdkDistModule(fileName: string): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  return resolveSdkDistModuleFrom(moduleDirectory, process.cwd(), fileName);
}

export function resolveSdkDistModuleFrom(
  moduleDirectory: string,
  workingDirectory: string,
  fileName: string,
): string {
  const candidates = [
    path.resolve(moduleDirectory, '..', '..', 'miniapp-sdk', 'dist', fileName),
    path.resolve(
      moduleDirectory,
      '..',
      'node_modules',
      '@theaiplatform',
      'miniapp-sdk',
      'dist',
      fileName,
    ),
    path.resolve(
      workingDirectory,
      'node_modules',
      '@theaiplatform',
      'miniapp-sdk',
      'dist',
      fileName,
    ),
  ];
  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) {
    throw new Error(
      `The installed @theaiplatform/miniapp-sdk is missing dist/${fileName}.`,
    );
  }
  return resolved;
}

function emitWebviewAssets(
  target: 'desktop' | 'mobile',
  sourceRoot: string,
  webview: NonNullable<OpenVsxPortConfig['conversion']['webview']>,
): RsbuildPlugin {
  return {
    name: 'tap-openvsx-static-webview-assets',
    setup(api) {
      api.processAssets(
        { stage: 'additional' },
        async ({ compilation, sources }) => {
          const files = (await readdir(sourceRoot, { recursive: true }))
            .map(String)
            .sort();
          for (const relativeFile of files) {
            const sourcePath = path.join(sourceRoot, relativeFile);
            if (!(await stat(sourcePath)).isFile()) continue;
            const canonical = relativeFile.split(path.sep).join(path.posix.sep);
            if (matchesAnyGlob(canonical, webview.exclude ?? [])) continue;
            const bytes = await readFile(sourcePath);
            const rewritten = rewriteWebviewAsset(canonical, bytes, webview);
            const externalized = externalizeInlineWebviewScripts(
              canonical,
              rewritten,
            );
            compilation.emitAsset(
              path.posix.join('targets', target, 'webview', canonical),
              new sources.RawSource(externalized.source),
            );
            for (const asset of externalized.assets) {
              const assetPath = path.posix.join(
                'targets',
                target,
                'webview',
                asset.relativeFile,
              );
              if (compilation.getAsset(assetPath)) {
                throw new Error(
                  `The generated CSP-safe webview script collides with an existing asset: ${asset.relativeFile}`,
                );
              }
              compilation.emitAsset(
                assetPath,
                new sources.RawSource(asset.source),
              );
            }
          }
          compilation.emitAsset(
            path.posix.join('targets', target, 'webview', RUNTIME_FILE_NAME),
            new sources.RawSource(tapVsCodeWebviewRuntimeSource),
          );
        },
      );
    },
  };
}

function rewriteWebviewAsset(
  relativeFile: string,
  bytes: Buffer,
  webview: NonNullable<OpenVsxPortConfig['conversion']['webview']>,
): Buffer {
  if (!/\.(?:css|html|js|mjs)$/iu.test(relativeFile)) return bytes;
  let content = bytes.toString('utf8');
  const directory = path.posix.dirname(relativeFile);
  for (const root of webview.rebaseRootPaths ?? []) {
    const normalized = root.replace(/^\/+|\/+$/gu, '');
    const relativeRoot = path.posix.relative(directory, normalized);
    const replacement =
      relativeRoot === ''
        ? './'
        : `${relativeRoot.startsWith('.') ? relativeRoot : `./${relativeRoot}`}/`;
    content = content.replaceAll(`/${normalized}/`, replacement);
  }
  for (const replacement of webview.replacements ?? []) {
    if (replacement.files && !matchesAnyGlob(relativeFile, replacement.files)) {
      continue;
    }
    content = content.replaceAll(replacement.search, replacement.replace);
  }
  return Buffer.from(content);
}

function externalizeInlineWebviewScripts(
  relativeFile: string,
  bytes: Buffer,
): { source: Buffer; assets: ExternalizedWebviewAsset[] } {
  if (!/\.html?$/iu.test(relativeFile)) {
    return { source: bytes, assets: [] };
  }
  const assets: ExternalizedWebviewAsset[] = [];
  const directory = path.posix.dirname(relativeFile);
  const stem = path.posix.basename(relativeFile).replace(/\.html?$/iu, '');
  const source = bytes
    .toString('utf8')
    .replace(
      /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu,
      (element, attributes: string, body: string) => {
        if (/\bsrc\s*=/iu.test(attributes)) return element;
        const type = scriptType(attributes);
        if (!isExecutableScriptType(type)) return element;
        if (body.trim() === '') return '';
        const index = assets.length + 1;
        const fileName = `${stem}.tap-inline-${String(index)}.js`;
        const assetRelativeFile =
          directory === '.' ? fileName : path.posix.join(directory, fileName);
        assets.push({ relativeFile: assetRelativeFile, source: body });
        return `<script${attributes} src="./${fileName}"></script>`;
      },
    );
  if (/\s(on[a-z][a-z0-9_-]*)\s*=/iu.test(source)) {
    throw new Error(
      `The static webview contains an inline event handler that cannot run under the TAP CSP: ${relativeFile}`,
    );
  }
  if (/\b(?:href|src)\s*=\s*(["'])javascript:/iu.test(source)) {
    throw new Error(
      `The static webview contains a javascript: URL that cannot run under the TAP CSP: ${relativeFile}`,
    );
  }
  return { source: Buffer.from(source), assets };
}

function scriptType(attributes: string): string | null {
  const match = attributes.match(
    /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu,
  );
  return (
    (match?.[1] ?? match?.[2] ?? match?.[3] ?? null)?.toLowerCase() ?? null
  );
}

function isExecutableScriptType(type: string | null): boolean {
  return (
    type === null ||
    type === 'module' ||
    type === 'text/javascript' ||
    type === 'application/javascript' ||
    type === 'text/ecmascript' ||
    type === 'application/ecmascript'
  );
}

function matchesAnyGlob(value: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(value));
}

function globToRegExp(pattern: string): RegExp {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern.charAt(index);
    const next = pattern[index + 1];
    if (character === '*' && next === '*') {
      source += '.*';
      index += 1;
    } else if (character === '*') {
      source += '[^/]*';
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += character.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&');
    }
  }
  return new RegExp(`${source}$`, 'u');
}

async function packGeneratedPackage(
  generatedRoot: string,
  outputTarball: string,
): Promise<void> {
  const destination = path.dirname(outputTarball);
  await mkdir(destination, { recursive: true });
  const result = await run(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', destination],
    generatedRoot,
  );
  const filename = npmPackFilename(result);
  if (!filename) throw new Error('npm pack did not report its tarball name.');
  const packed = path.join(destination, filename);
  if (packed !== outputTarball) {
    await rm(outputTarball, { force: true });
    await rename(packed, outputTarball);
  }
}

function npmPackFilename(result: string): string | undefined {
  const parsed = JSON.parse(result) as unknown;
  const entry = isUnknownArray(parsed)
    ? parsed[0]
    : isRecord(parsed)
      ? Object.values(parsed)[0]
      : undefined;
  if (!isRecord(entry)) return undefined;
  const filename = entry.filename;
  return typeof filename === 'string' && filename.length > 0
    ? filename
    : undefined;
}

function run(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve(stdout);
      else {
        reject(
          new Error(
            `${command} failed (${signal ? `signal ${signal}` : `exit ${String(code)}`}): ${stderr.trim()}`,
          ),
        );
      }
    });
  });
}

function networkOriginsFor(config: OpenVsxPortConfig): string[] {
  const network = config.conversion.network;
  if (!network || typeof network !== 'object' || Array.isArray(network)) {
    return [];
  }
  const allow = (network as Record<string, unknown>).allow;
  if (!Array.isArray(allow)) return [];
  return allow.map((value, index) => {
    const raw = requiredString(
      value,
      `conversion.network.allow[${String(index)}]`,
    );
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.origin !== raw) {
      throw new Error(
        'conversion.network.allow entries must be exact HTTPS origins.',
      );
    }
    return url.origin;
  });
}

function resolveDescription(config: OpenVsxPortConfig): string {
  const presentation = requiredRecord(
    requiredRecord(config.tap, 'tap').presentation,
    'tap.presentation',
  );
  const template = requiredString(
    presentation.descriptionTemplate,
    'tap.presentation.descriptionTemplate',
  );
  const description = template.replaceAll(
    '{{source.version}}',
    config.source.version,
  );
  if (description.includes('{{')) {
    throw new Error('tap.presentation.descriptionTemplate is unresolved.');
  }
  if (!description.includes(`v${config.source.version}`)) {
    throw new Error(
      'The TAP description must include the exact upstream extension version.',
    );
  }
  return description;
}

function createPackageReadme(config: OpenVsxPortConfig): string {
  return [
    `# ${config.npm.name}`,
    '',
    resolveDescription(config),
    '',
    `Converted from \`${config.source.extensionId}@${config.source.version}\` by \`@theaiplatform/openvsx-port\`.`,
    '',
  ].join('\n');
}

function exposeForSurface(surfaceId: string): string {
  return `./ui/${surfaceId}`;
}

function safeFileSegment(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)) {
    throw new Error(
      `The generated surface id is not a safe file name: ${value}`,
    );
  }
  return value;
}

function federationName(namespace: string, target: string): string {
  return `tap_${namespace}_${target}`.replaceAll(/[^A-Za-z0-9_]/gu, '_');
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
