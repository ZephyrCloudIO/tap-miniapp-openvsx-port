import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from '@rstest/core';
import { loadPortConfig } from './config.js';

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
