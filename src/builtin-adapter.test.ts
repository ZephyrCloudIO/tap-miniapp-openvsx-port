import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from '@rstest/core';
import {
  buildBuiltinStaticWebviewMiniapp,
  canUseBuiltinStaticWebviewAdapter,
} from './builtin-adapter.js';
import type { OpenVsxPortConfig } from './types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it('builds an installable package without executing the extension host', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'tap-openvsx-builtin-adapter-'),
  );
  temporaryDirectories.push(directory);
  const webview = path.join(directory, 'webview');
  const workingDirectory = path.join(directory, '.tap-openvsx-build');
  const tarball = path.join(directory, 'visual-editor.tgz');
  await mkdir(path.join(webview, 'assets'), { recursive: true });
  await writeFile(
    path.join(webview, 'index.html'),
    '<!doctype html><div id="root"></div><script>window.ASSET_PATH="{{asset-path}}"</script><script type="module" src="/assets/app.js"></script>',
  );
  await writeFile(
    path.join(webview, 'assets', 'app.js'),
    'acquireVsCodeApi().postMessage({type:"ready"})',
  );
  await writeFile(
    path.join(webview, 'assets', 'app.css'),
    '@font-face{src:url(/assets/editor.woff2)}',
  );
  const config = fixtureConfig();

  expect(canUseBuiltinStaticWebviewAdapter(config)).toBe(true);
  await buildBuiltinStaticWebviewMiniapp({
    config,
    workingDirectory,
    webviewRootDirectory: webview,
    outputTarball: tarball,
  });

  expect((await stat(tarball)).size).toBeGreaterThan(1_000);
  const manifest = JSON.parse(
    await readFile(
      path.join(workingDirectory, 'generated-miniapp/dist/manifest.tap.json'),
      'utf8',
    ),
  ) as {
    presentation: { description: string };
    targets: { desktop: { assetLock: string } };
    contributions: Array<{
      kind: string;
      id: string;
      authorization?: {
        allOf?: string[];
        effects?: Array<{ kind: string; resources: string[] }>;
      };
    }>;
  };
  expect(manifest.presentation.description).toContain(
    'example.visual-editor v2.0.0',
  );
  expect(manifest.targets.desktop.assetLock).toBe(
    'targets/desktop/tap.package.lock.json',
  );
  const surfaces = manifest.contributions.filter(
    (contribution) => contribution.kind === 'ui.surface',
  );
  expect(surfaces.map((surface) => surface.id)).toEqual([
    'visual-editor',
    'visual-editor-channel',
  ]);
  for (const surface of surfaces) {
    expect(surface.authorization?.allOf).toBeUndefined();
    expect(surface.authorization?.effects).toEqual([
      { kind: 'storage', resources: ['visual-editor'] },
    ]);
  }
  expect(
    manifest.contributions.some(
      (contribution) => contribution.kind === 'permission.catalog',
    ),
  ).toBe(false);
  expect(
    await readFile(
      path.join(
        workingDirectory,
        'generated-miniapp/dist/targets/desktop/webview/tap-vscode-webview-runtime.js',
      ),
      'utf8',
    ),
  ).toContain('acquireVsCodeApi');
  expect(
    await readFile(
      path.join(
        workingDirectory,
        'generated-miniapp/dist/targets/desktop/webview/index.html',
      ),
      'utf8',
    ),
  ).toContain('src="./assets/app.js"');
  expect(
    await readFile(
      path.join(
        workingDirectory,
        'generated-miniapp/dist/targets/desktop/webview/index.html',
      ),
      'utf8',
    ),
  ).not.toContain('window.ASSET_PATH="./"');
  expect(
    await readFile(
      path.join(
        workingDirectory,
        'generated-miniapp/dist/targets/desktop/webview/index.html',
      ),
      'utf8',
    ),
  ).toContain('src="./index.tap-inline-1.js"');
  expect(
    await readFile(
      path.join(
        workingDirectory,
        'generated-miniapp/dist/targets/desktop/webview/index.tap-inline-1.js',
      ),
      'utf8',
    ),
  ).toContain('window.ASSET_PATH="./"');
  expect(
    await readFile(
      path.join(
        workingDirectory,
        'generated-miniapp/dist/targets/desktop/webview/assets/app.css',
      ),
      'utf8',
    ),
  ).toContain('url(./editor.woff2)');
});

function fixtureConfig(): OpenVsxPortConfig {
  return {
    schemaVersion: 1,
    converter: {
      repository: 'https://github.com/ZephyrCloudIO/tap-miniapp-openvsx-port',
      package: '@theaiplatform/openvsx-port',
      version: '0.1.12',
      binary: 'tap-openvsx',
    },
    source: {
      provider: 'visualstudio-marketplace',
      registryUrl: 'https://marketplace.visualstudio.com',
      extensionId: 'example.visual-editor',
      version: '2.0.0',
      sha256: 'a'.repeat(64),
    },
    conversion: {
      profile: 'static-webview',
      targets: ['desktop'],
      webview: {
        source: 'extension',
        root: 'extension/webview',
        entry: 'index.html',
        rebaseRootPaths: ['assets'],
        replacements: [
          {
            search: '{{asset-path}}',
            replace: './',
            files: ['index.html'],
          },
        ],
      },
      bridge: {
        kind: 'vscode-custom-editor',
        viewType: 'editor.visual',
        bootstrap: {
          selector: '#root',
          attribute: 'data-config',
          encoding: 'base64-json',
          value: { content: [] },
        },
        storage: {
          namespace: 'visual-editor',
          key: 'document',
          initialValue: { content: '' },
          messageBindings: [
            {
              messageType: 'change',
              messageValuePath: ['content'],
              statePath: ['content'],
              transform: 'byte-array-to-base64',
            },
          ],
          bootstrapBindings: [
            {
              statePath: ['content'],
              bootstrapPath: ['content'],
              transform: 'base64-to-byte-array',
            },
          ],
        },
        requiredHostOperations: [
          'document.read',
          'document.write',
          'storage.get',
          'storage.set',
        ],
      },
    },
    tap: {
      package: {
        packageId: 'tap_pkg_example_visual_editor_0001',
        publisherId: 'publisher_example',
        organizationId: 'organization_example',
        namespace: 'example-visual-editor',
        slug: 'visual-editor',
      },
      release: { version: '2.0.0-tap.1' },
      presentation: {
        name: 'Visual Editor',
        descriptionTemplate:
          'Visual editor ported from example.visual-editor v{{source.version}}.',
      },
      surfaces: [
        {
          id: 'visual-editor',
          displayName: 'Visual Editor',
          placement: 'workspace-left',
          scope: 'workspace',
          instancePolicy: 'per-workspace',
          persistence: 'retained',
        },
        {
          id: 'visual-editor-channel',
          displayName: 'Visual Editor',
          placement: 'channel-apps',
          scope: 'channel',
          instancePolicy: 'per-channel',
          persistence: 'retained',
        },
      ],
      compatibility: { tapSdk: '0.3.3', tapHost: '>=0.1.0' },
    },
    npm: {
      name: '@example/visual-editor-tap-miniapp',
      version: '2.0.0-tap.1',
      access: 'public',
      registry: 'https://registry.npmjs.org',
    },
    output: {
      workingDirectory: '.tap-openvsx-build/example',
      npmTarball: 'artifacts/visual-editor.tgz',
      compatibilityReport: 'artifacts/compatibility.json',
      attestation: 'artifacts/attestation.json',
    },
  };
}
