import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from '@rstest/core';
import { loadPortConfig } from './config.js';
import { convertOpenVsxExtension } from './convert.js';

it('loads a bounded generic recipe', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'tap-openvsx-config-'),
  );
  const configPath = path.join(directory, 'tap.openvsx.json');
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      source: {
        provider: 'openvsx',
        registryUrl: 'https://open-vsx.org',
        extensionId: 'example.extension',
        version: '1.2.3',
        sha256: 'a'.repeat(64),
      },
      conversion: {
        profile: 'static-webview',
        targets: ['desktop'],
      },
      tap: {},
      npm: {
        name: '@example/extension-miniapp',
        version: '1.2.3-tap.1',
        access: 'public',
        registry: 'https://registry.npmjs.org',
      },
      output: {
        workingDirectory: '.tap-openvsx-build/example/extension',
        npmTarball: 'artifacts/extension.tgz',
        compatibilityReport: 'artifacts/compatibility.json',
        attestation: 'artifacts/attestation.json',
      },
    }),
  );
  const loaded = await loadPortConfig(configPath);
  expect(loaded.value.source.extensionId).toBe('example.extension');
  expect(loaded.value.conversion.profile).toBe('static-webview');
});

it('rejects duplicate targets', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'tap-openvsx-config-'),
  );
  const configPath = path.join(directory, 'tap.openvsx.json');
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      source: {
        provider: 'openvsx',
        registryUrl: 'https://open-vsx.org',
        extensionId: 'example.extension',
        version: '1.2.3',
        sha256: 'a'.repeat(64),
      },
      conversion: {
        profile: 'static-webview',
        targets: ['desktop', 'desktop'],
      },
      tap: {},
      npm: {
        name: '@example/extension-miniapp',
        version: '1.2.3-tap.1',
        access: 'public',
        registry: 'https://registry.npmjs.org',
      },
      output: {
        workingDirectory: '.tap-openvsx-build/example/extension',
        npmTarball: 'artifacts/extension.tgz',
        compatibilityReport: 'artifacts/compatibility.json',
        attestation: 'artifacts/attestation.json',
      },
    }),
  );
  await expect(loadPortConfig(configPath)).rejects.toThrow(
    /targets must be unique/u,
  );
});

it('loads a Visual Studio Marketplace source with an embedded webview', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'tap-openvsx-config-'),
  );
  const configPath = path.join(directory, 'tap.openvsx.json');
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      source: {
        provider: 'visualstudio-marketplace',
        registryUrl: 'https://marketplace.visualstudio.com',
        extensionId: 'example.extension',
        version: '1.2.3',
        sha256: 'a'.repeat(64),
      },
      conversion: {
        profile: 'static-webview',
        targets: ['desktop'],
        webview: {
          source: 'extension',
          root: 'extension/webview/dist',
          entry: 'index.html',
        },
      },
      tap: {},
      npm: {
        name: '@example/extension-miniapp',
        version: '1.2.3-tap.1',
        access: 'public',
        registry: 'https://registry.npmjs.org',
      },
      output: {
        workingDirectory: '.tap-openvsx-build/example/extension',
        npmTarball: 'artifacts/extension.tgz',
        compatibilityReport: 'artifacts/compatibility.json',
        attestation: 'artifacts/attestation.json',
      },
    }),
  );
  const loaded = await loadPortConfig(configPath);
  expect(loaded.value.source.provider).toBe('visualstudio-marketplace');
  expect(loaded.value.conversion.webview?.source).toBe('extension');
});

it('rejects an ambiguous embedded and archived webview source', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'tap-openvsx-config-'),
  );
  const configPath = path.join(directory, 'tap.openvsx.json');
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      source: {
        provider: 'openvsx',
        registryUrl: 'https://open-vsx.org',
        extensionId: 'example.extension',
        version: '1.2.3',
        sha256: 'a'.repeat(64),
      },
      conversion: {
        profile: 'static-webview',
        targets: ['desktop'],
        webview: {
          source: 'extension',
          archive: {
            url: 'https://example.com/webview.zip',
            version: '1.2.3',
            sha256: 'b'.repeat(64),
          },
        },
      },
      tap: {},
      npm: {
        name: '@example/extension-miniapp',
        version: '1.2.3-tap.1',
        access: 'public',
        registry: 'https://registry.npmjs.org',
      },
      output: {
        workingDirectory: '.tap-openvsx-build/example/extension',
        npmTarball: 'artifacts/extension.tgz',
        compatibilityReport: 'artifacts/compatibility.json',
        attestation: 'artifacts/attestation.json',
      },
    }),
  );
  await expect(loadPortConfig(configPath)).rejects.toThrow(
    /cannot declare both/u,
  );
});

it('rejects conversion with a mismatched converter pin', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'tap-openvsx-config-'),
  );
  const configPath = path.join(directory, 'tap.openvsx.json');
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      converter: {
        repository: 'https://github.com/ZephyrCloudIO/tap-miniapp-openvsx-port',
        package: '@theaiplatform/openvsx-port',
        version: '0.1.8',
        binary: 'tap-openvsx',
      },
      source: {
        provider: 'openvsx',
        registryUrl: 'https://open-vsx.org',
        extensionId: 'example.extension',
        version: '1.2.3',
        sha256: 'a'.repeat(64),
      },
      conversion: {
        profile: 'static-webview',
        targets: ['desktop'],
      },
      tap: {},
      npm: {
        name: '@example/extension-miniapp',
        version: '1.2.3-tap.1',
        access: 'public',
        registry: 'https://registry.npmjs.org',
      },
      output: {
        workingDirectory: '.tap-openvsx-build/example/extension',
        npmTarball: 'artifacts/extension.tgz',
        compatibilityReport: 'artifacts/compatibility.json',
        attestation: 'artifacts/attestation.json',
      },
    }),
  );

  await expect(
    convertOpenVsxExtension({
      config: configPath,
      source: path.join(directory, 'missing.vsix'),
      skipAdapter: true,
    }),
  ).rejects.toThrow(/this converter is .*0\.1\.11/u);
});
