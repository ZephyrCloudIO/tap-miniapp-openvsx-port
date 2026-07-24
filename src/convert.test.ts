import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from '@rstest/core';
import yazl from 'yazl';
import { convertOpenVsxExtension } from './convert.js';
import { sha256File } from './digest.js';
import { CONVERTER_PACKAGE, CONVERTER_VERSION } from './version.js';

it('stages an embedded Marketplace webview without executing the extension', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tap-port-convert-'));
  const archive = path.join(directory, 'extension.vsix');
  await createZip(archive, {
    'extension/package.json': JSON.stringify({
      publisher: 'example',
      name: 'visual-editor',
      version: '2.0.0',
      browser: './dist/extension.js',
      contributes: {
        customEditors: [
          {
            viewType: 'editor.visual',
            displayName: 'Visual Editor',
            selector: [{ filenamePattern: '*.visual' }],
          },
        ],
      },
    }),
    'extension/dist/extension.js':
      'throw new Error("extension code must never execute");',
    'extension/webview/dist/index.html': '<main>Visual editor</main>',
  });
  const workingDirectory = `.tap-openvsx-build/${path.basename(directory)}`;
  const configPath = path.join(directory, 'tap.openvsx.json');
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      converter: {
        repository: 'https://github.com/ZephyrCloudIO/tap-miniapp-openvsx-port',
        package: CONVERTER_PACKAGE,
        version: CONVERTER_VERSION,
        binary: 'tap-openvsx',
      },
      source: {
        provider: 'visualstudio-marketplace',
        registryUrl: 'https://marketplace.visualstudio.com',
        extensionId: 'example.visual-editor',
        version: '2.0.0',
        sha256: await sha256File(archive),
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
        name: '@example/visual-editor',
        version: '2.0.0-tap.1',
        access: 'public',
        registry: 'https://registry.npmjs.org',
      },
      output: {
        workingDirectory,
        npmTarball: path.join(directory, 'visual-editor.tgz'),
        compatibilityReport: path.join(directory, 'compatibility.json'),
        attestation: path.join(directory, 'attestation.json'),
      },
    }),
  );

  try {
    const result = await convertOpenVsxExtension({
      config: configPath,
      source: archive,
      skipAdapter: true,
    });
    const resolvedPath = path.resolve(
      workingDirectory,
      'tap.openvsx.resolved.json',
    );
    const resolved = JSON.parse(await readFile(resolvedPath, 'utf8')) as {
      resolved: {
        webviewDirectory: string;
        webviewRootDirectory: string;
      };
    };
    expect(result.inspection.extension.id).toBe('example.visual-editor');
    expect(resolved.resolved.webviewDirectory).toBe(
      path.resolve(workingDirectory, 'extension'),
    );
    expect(resolved.resolved.webviewRootDirectory).toBe(
      path.resolve(workingDirectory, 'extension/extension/webview/dist'),
    );
  } finally {
    await rm(path.resolve(workingDirectory), {
      recursive: true,
      force: true,
    });
  }
});

function createZip(
  destination: string,
  entries: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const [name, value] of Object.entries(entries)) {
      zip.addBuffer(Buffer.from(value), name);
    }
    zip.outputStream
      .pipe(createWriteStream(destination))
      .once('error', reject)
      .once('close', resolve);
    zip.end();
  });
}
