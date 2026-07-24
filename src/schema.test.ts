import { expect, it } from '@rstest/core';
import { Ajv2020 } from 'ajv/dist/2020.js';
import configSchema from '../config-schema.json' with { type: 'json' };

const validate = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
}).compile(configSchema);

it('publishes a strict-compatible JSON Schema for Marketplace recipes', () => {
  expect(
    validate({
      schemaVersion: 1,
      source: {
        provider: 'visualstudio-marketplace',
        registryUrl: 'https://marketplace.visualstudio.com',
        extensionId: 'pomdtr.excalidraw-editor',
        version: '3.9.3',
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
        name: '@example/excalidraw-miniapp',
        version: '3.9.3-tap.1',
        access: 'public',
        registry: 'https://registry.npmjs.org',
      },
      output: {
        workingDirectory: '.tap-openvsx-build/example',
        npmTarball: 'artifacts/example.tgz',
        compatibilityReport: 'artifacts/example.compatibility.json',
        attestation: 'artifacts/example.attestation.json',
      },
    }),
    JSON.stringify(validate.errors),
  ).toBe(true);
});

it('rejects a webview with both embedded and archived sources', () => {
  expect(
    validate({
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
        workingDirectory: '.tap-openvsx-build/example',
        npmTarball: 'artifacts/example.tgz',
        compatibilityReport: 'artifacts/example.compatibility.json',
        attestation: 'artifacts/example.attestation.json',
      },
    }),
  ).toBe(false);
});
