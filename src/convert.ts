import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractZip } from './archive.js';
import {
  buildBuiltinStaticWebviewMiniapp,
  canUseBuiltinStaticWebviewAdapter,
} from './builtin-adapter.js';
import { loadPortConfig } from './config.js';
import { sha256Bytes, sha256File } from './digest.js';
import { inspectVsix } from './inspect.js';
import { acquireFile, extensionDownloadUrl } from './source.js';
import { CONVERTER_PACKAGE, CONVERTER_VERSION } from './version.js';
import type {
  ConversionResult,
  OpenVsxPortConfig,
  TrustedAdapterConfig,
} from './types.js';

export interface ConvertOptions {
  config: string;
  source?: string;
  skipAdapter?: boolean;
}

export async function convertOpenVsxExtension(
  options: ConvertOptions,
): Promise<ConversionResult> {
  const loaded = await loadPortConfig(options.config);
  const config = loaded.value;
  assertConverterPin(config);
  const projectRoot = process.cwd();
  const paths = resolveOutputPaths(projectRoot, config);
  assertSafeWorkingDirectory(projectRoot, paths.workingDirectory);
  await rm(paths.workingDirectory, { recursive: true, force: true });
  await mkdir(paths.workingDirectory, { recursive: true });

  const extensionArchive = path.join(paths.workingDirectory, 'source.vsix');
  const sourceInput = options.source ?? extensionDownloadUrl(config.source);
  await acquireFile(sourceInput, extensionArchive);
  await assertDigest(extensionArchive, config.source.sha256, 'extension');
  const inspection = await inspectVsix(extensionArchive);
  assertExtensionIdentity(
    config,
    inspection.extension.id,
    inspection.extension.version,
  );

  const extensionDirectory = path.join(paths.workingDirectory, 'extension');
  await extractZip(extensionArchive, extensionDirectory);

  let webviewArchive: string | null = null;
  let webviewDirectory: string | null = null;
  let webviewRootDirectory: string | null = null;
  const declaredWebviewArchive = config.conversion.webview?.archive;
  if (declaredWebviewArchive) {
    webviewArchive = path.join(paths.workingDirectory, 'webview.zip');
    await acquireFile(declaredWebviewArchive.url, webviewArchive);
    await assertDigest(
      webviewArchive,
      declaredWebviewArchive.sha256,
      'webview archive',
    );
    webviewDirectory = path.join(paths.workingDirectory, 'webview');
    await extractZip(webviewArchive, webviewDirectory);
    webviewRootDirectory = await resolveWebviewRootDirectory(
      config,
      webviewDirectory,
    );
  } else if (config.conversion.webview?.source === 'extension') {
    webviewDirectory = extensionDirectory;
    webviewRootDirectory = await resolveWebviewRootDirectory(
      config,
      extensionDirectory,
    );
  }
  const webviewAssetDigests = webviewRootDirectory
    ? await materializePinnedWebviewAssets(config, webviewRootDirectory)
    : {};

  const resolvedRecipePath = path.join(
    paths.workingDirectory,
    'tap.openvsx.resolved.json',
  );
  await writeJson(resolvedRecipePath, {
    ...config,
    resolved: {
      sourceInput: redactSource(sourceInput),
      extensionArchive,
      extensionDirectory,
      webviewArchive,
      webviewDirectory,
      webviewRootDirectory,
    },
  });

  const compatibilityReport = {
    schemaVersion: 1,
    converter: {
      package: CONVERTER_PACKAGE,
      version: CONVERTER_VERSION,
    },
    source: config.source,
    inspection,
    adapter:
      config.conversion.adapter ??
      (canUseBuiltinStaticWebviewAdapter(config)
        ? {
            kind: 'builtin-static-webview',
            package: CONVERTER_PACKAGE,
            version: CONVERTER_VERSION,
          }
        : null),
    status: options.skipAdapter ? 'staged' : 'adapter-required',
  };

  if (!options.skipAdapter) {
    if (config.conversion.adapter) {
      await runAdapter(config.conversion.adapter, {
        configPath: loaded.path,
        resolvedRecipePath,
        workingDirectory: paths.workingDirectory,
        extensionArchive,
        extensionDirectory,
        webviewArchive,
        webviewDirectory,
        webviewRootDirectory,
        outputTarball: paths.npmTarball,
      });
    } else if (
      webviewRootDirectory &&
      canUseBuiltinStaticWebviewAdapter(config)
    ) {
      await buildBuiltinStaticWebviewMiniapp({
        config,
        workingDirectory: paths.workingDirectory,
        webviewRootDirectory,
        outputTarball: paths.npmTarball,
      });
    } else {
      requireAdapter(config.conversion.adapter);
    }
    await assertRegularFile(paths.npmTarball, 'adapter npm tarball');
    compatibilityReport.status = 'compatible';
  }

  await mkdir(path.dirname(paths.compatibilityReport), { recursive: true });
  await writeJson(paths.compatibilityReport, compatibilityReport);

  const inputDigests: Record<string, string> = {
    recipe: sha256Bytes(await readFile(loaded.path)),
    extension: await sha256File(extensionArchive),
  };
  if (webviewArchive) inputDigests.webview = await sha256File(webviewArchive);
  Object.assign(inputDigests, webviewAssetDigests);
  const outputDigests: Record<string, string> = {
    compatibilityReport: await sha256File(paths.compatibilityReport),
  };
  if (!options.skipAdapter) {
    outputDigests.npmTarball = await sha256File(paths.npmTarball);
  }
  await mkdir(path.dirname(paths.attestation), { recursive: true });
  await writeJson(paths.attestation, {
    schemaVersion: 1,
    predicateType: 'https://theaiplatform.app/attestations/openvsx-port/v1',
    subject: {
      npmPackage: config.npm.name,
      npmVersion: config.npm.version,
    },
    builder: {
      package: CONVERTER_PACKAGE,
      version: CONVERTER_VERSION,
    },
    inputs: inputDigests,
    outputs: outputDigests,
    sourceDateEpoch: process.env.SOURCE_DATE_EPOCH ?? null,
  });

  return {
    tarballPath: paths.npmTarball,
    compatibilityReportPath: paths.compatibilityReport,
    attestationPath: paths.attestation,
    inspection,
  };
}

export async function materializePinnedWebviewAssets(
  config: OpenVsxPortConfig,
  webviewRootDirectory: string,
): Promise<Record<string, string>> {
  const digests: Record<string, string> = {};
  const root = path.resolve(webviewRootDirectory);
  for (const [index, asset] of (
    config.conversion.webview?.assets ?? []
  ).entries()) {
    const relativePath = normalizedAssetPath(asset.path);
    const destination = path.resolve(root, ...relativePath.split('/'));
    if (!destination.startsWith(`${root}${path.sep}`)) {
      throw new Error(
        `The pinned webview asset path escapes its root: ${asset.path}`,
      );
    }
    try {
      await access(destination);
    } catch (error) {
      if (isMissingFileError(error)) {
        await acquireFile(asset.url, destination);
        await assertDigest(
          destination,
          asset.sha256,
          `webview asset '${relativePath}'`,
        );
        digests[`webviewAsset:${String(index)}:${relativePath}`] =
          await sha256File(destination);
        continue;
      }
      throw error;
    }
    throw new Error(
      `The pinned webview asset collides with an existing file: ${relativePath}`,
    );
  }
  return digests;
}

export async function verifyConversionOutputs(
  configPath: string,
): Promise<void> {
  const loaded = await loadPortConfig(configPath);
  assertConverterPin(loaded.value);
  const paths = resolveOutputPaths(process.cwd(), loaded.value);
  await Promise.all([
    assertRegularFile(paths.npmTarball, 'npm tarball'),
    assertRegularFile(paths.compatibilityReport, 'compatibility report'),
    assertRegularFile(paths.attestation, 'attestation'),
  ]);
  const attestation = JSON.parse(
    await readFile(paths.attestation, 'utf8'),
  ) as unknown;
  if (!isAttestation(attestation)) {
    throw new Error('The conversion attestation has an invalid shape.');
  }
  const actualTarballDigest = await sha256File(paths.npmTarball);
  if (attestation.outputs.npmTarball !== actualTarballDigest) {
    throw new Error(
      'The npm tarball does not match the conversion attestation.',
    );
  }
}

function resolveOutputPaths(
  directory: string,
  config: OpenVsxPortConfig,
): {
  workingDirectory: string;
  npmTarball: string;
  compatibilityReport: string;
  attestation: string;
} {
  return {
    workingDirectory: path.resolve(directory, config.output.workingDirectory),
    npmTarball: path.resolve(directory, config.output.npmTarball),
    compatibilityReport: path.resolve(
      directory,
      config.output.compatibilityReport,
    ),
    attestation: path.resolve(directory, config.output.attestation),
  };
}

function assertConverterPin(config: OpenVsxPortConfig): void {
  const pin = config.converter;
  if (!pin) {
    throw new Error('The conversion recipe must pin its converter.');
  }
  if (
    pin.package !== CONVERTER_PACKAGE ||
    pin.binary !== 'tap-openvsx' ||
    pin.version !== CONVERTER_VERSION
  ) {
    throw new Error(
      `The recipe pins ${pin.package}@${pin.version} (${pin.binary}), but this converter is ${CONVERTER_PACKAGE}@${CONVERTER_VERSION} (tap-openvsx).`,
    );
  }
}

function assertSafeWorkingDirectory(projectRoot: string, target: string): void {
  const root = path.parse(target).root;
  const home = path.resolve(os.homedir());
  const project = path.resolve(projectRoot);
  if (
    target === root ||
    target === home ||
    target === project ||
    !target.startsWith(`${project}${path.sep}`) ||
    !target.split(path.sep).includes('.tap-openvsx-build')
  ) {
    throw new Error(
      'output.workingDirectory must be a .tap-openvsx-build descendant of the current project directory.',
    );
  }
}

async function assertDigest(
  filePath: string,
  expected: string,
  label: string,
): Promise<void> {
  const actual = await sha256File(filePath);
  if (actual !== expected) {
    throw new Error(
      `The ${label} SHA-256 does not match the pinned recipe (${actual}).`,
    );
  }
}

function assertExtensionIdentity(
  config: OpenVsxPortConfig,
  actualId: string,
  actualVersion: string,
): void {
  if (actualId.toLowerCase() !== config.source.extensionId.toLowerCase()) {
    throw new Error(
      `The VSIX identity is ${actualId}, expected ${config.source.extensionId}.`,
    );
  }
  if (actualVersion !== config.source.version) {
    throw new Error(
      `The VSIX version is ${actualVersion}, expected ${config.source.version}.`,
    );
  }
}

async function resolveWebviewRootDirectory(
  config: OpenVsxPortConfig,
  sourceDirectory: string,
): Promise<string> {
  const root = config.conversion.webview?.root ?? '.';
  const entry = config.conversion.webview?.entry;
  const webviewDirectory = path.resolve(sourceDirectory, root);
  if (
    webviewDirectory !== sourceDirectory &&
    !webviewDirectory.startsWith(`${sourceDirectory}${path.sep}`)
  ) {
    throw new Error('The configured webview root escapes its source.');
  }
  if (entry) {
    const expected = path.resolve(webviewDirectory, entry);
    if (
      expected !== webviewDirectory &&
      !expected.startsWith(`${webviewDirectory}${path.sep}`)
    ) {
      throw new Error('The configured webview entry escapes its root.');
    }
    await assertRegularFile(expected, 'webview entry');
  }
  return webviewDirectory;
}

function requireAdapter(
  adapter: TrustedAdapterConfig | undefined,
): TrustedAdapterConfig {
  if (!adapter) {
    throw new Error(
      'conversion.adapter must pin a trusted adapter package for final TAP compilation. Use --skip-adapter only for inspection/staging.',
    );
  }
  return adapter;
}

async function runAdapter(
  adapter: TrustedAdapterConfig,
  context: {
    configPath: string;
    resolvedRecipePath: string;
    workingDirectory: string;
    extensionArchive: string;
    extensionDirectory: string;
    webviewArchive: string | null;
    webviewDirectory: string | null;
    webviewRootDirectory: string | null;
    outputTarball: string;
  },
): Promise<void> {
  await mkdir(path.dirname(context.outputTarball), { recursive: true });
  const packageSpec = `${adapter.package}@${adapter.version}`;
  const args = [
    '--yes',
    '--package',
    packageSpec,
    '--',
    adapter.binary,
    ...adapter.args,
  ];
  const env = {
    ...process.env,
    TAP_OPENVSX_CONFIG: context.configPath,
    TAP_OPENVSX_RESOLVED_CONFIG: context.resolvedRecipePath,
    TAP_OPENVSX_WORKING_DIRECTORY: context.workingDirectory,
    TAP_OPENVSX_EXTENSION_ARCHIVE: context.extensionArchive,
    TAP_OPENVSX_EXTENSION_DIRECTORY: context.extensionDirectory,
    TAP_OPENVSX_OUTPUT_TARBALL: context.outputTarball,
    ...(context.webviewArchive
      ? { TAP_OPENVSX_WEBVIEW_ARCHIVE: context.webviewArchive }
      : {}),
    ...(context.webviewDirectory
      ? { TAP_OPENVSX_WEBVIEW_DIRECTORY: context.webviewDirectory }
      : {}),
    ...(context.webviewRootDirectory
      ? {
          TAP_OPENVSX_WEBVIEW_ROOT_DIRECTORY: context.webviewRootDirectory,
        }
      : {}),
  };
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npm', ['exec', ...args], {
      cwd: context.workingDirectory,
      env,
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `The trusted adapter failed (${signal ? `signal ${signal}` : `exit ${String(code)}`}).`,
          ),
        );
      }
    });
  });
}

async function assertRegularFile(
  filePath: string,
  label: string,
): Promise<void> {
  await access(filePath);
  const fileStats = await stat(filePath);
  if (!fileStats.isFile())
    throw new Error(`The ${label} is not a regular file.`);
}

function normalizedAssetPath(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:/u.test(normalized) ||
    normalized
      .split('/')
      .some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(
      `Pinned webview assets require a relative file path without traversal: ${value}`,
    );
  }
  return normalized;
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

function redactSource(input: string): string {
  try {
    const url = new URL(input);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return path.basename(input);
  }
}

function isAttestation(value: unknown): value is {
  outputs: { npmTarball: string };
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const outputs: unknown = 'outputs' in value ? value.outputs : undefined;
  const npmTarball: unknown =
    outputs && typeof outputs === 'object' && 'npmTarball' in outputs
      ? outputs.npmTarball
      : undefined;
  return (
    Boolean(outputs) &&
    typeof outputs === 'object' &&
    !Array.isArray(outputs) &&
    typeof npmTarball === 'string' &&
    /^[a-f0-9]{64}$/u.test(npmTarball)
  );
}
