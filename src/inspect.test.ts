import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from '@rstest/core';
import yazl from 'yazl';
import { inspectVsix } from './inspect.js';
import { extractZip, inspectZip } from './archive.js';

it('inspects a browser extension without executing it', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tap-openvsx-vsix-'));
  const archive = path.join(directory, 'extension.vsix');
  await createZip(archive, {
    'extension/package.json': JSON.stringify({
      publisher: 'example',
      name: 'visual-editor',
      version: '2.0.0',
      displayName: 'Visual Editor',
      browser: './dist/browser.js',
      activationEvents: ['onStartupFinished'],
      contributes: {
        customEditors: [
          {
            viewType: 'editor.visual',
            displayName: 'Visual Editor',
            priority: 'default',
            selector: [{ filenamePattern: '*.visual' }],
          },
        ],
        commands: [{ command: 'visual.newFile' }],
        configuration: [
          {
            properties: {
              'visual.theme': { type: 'string' },
            },
          },
        ],
      },
    }),
    'extension/dist/browser.js': 'throw new Error("must never execute");',
  });
  const result = await inspectVsix(archive);
  expect(result.extension.id).toBe('example.visual-editor');
  expect(result.classification).toBe('browser-extension-host');
  expect(result.findings.join(' ')).toMatch(/explicit adapter/u);
  expect(result.extension.customEditors).toEqual([
    {
      viewType: 'editor.visual',
      displayName: 'Visual Editor',
      priority: 'default',
      filenamePatterns: ['*.visual'],
    },
  ]);
  expect(result.extension.commands).toEqual(['visual.newFile']);
  expect(result.extension.configurationKeys).toEqual(['visual.theme']);
  expect(result.findings.join(' ')).toMatch(/document and webview bridge/u);
});

it('rejects archive traversal', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tap-openvsx-vsix-'));
  const archive = path.join(directory, 'unsafe.vsix');
  await createZip(archive, { 'aa/escape.txt': 'nope' });
  const bytes = await readFile(archive);
  const safeName = Buffer.from('aa/escape.txt');
  const unsafeName = Buffer.from('../escape.txt');
  let replacementCount = 0;
  for (
    let offset = bytes.indexOf(safeName);
    offset >= 0;
    offset = bytes.indexOf(safeName, offset + unsafeName.byteLength)
  ) {
    unsafeName.copy(bytes, offset);
    replacementCount += 1;
  }
  expect(replacementCount).toBe(2);
  await writeFile(archive, bytes);
  await expect(inspectZip(archive)).rejects.toThrow(
    /(Unsafe ZIP entry path|invalid relative path)/u,
  );
});

it('extracts every entry from a large lazy archive', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tap-openvsx-vsix-'));
  const archive = path.join(directory, 'many-entries.vsix');
  const destination = path.join(directory, 'extracted');
  const entryCount = 2_048;
  await createZip(
    archive,
    Object.fromEntries(
      Array.from({ length: entryCount }, (_, index) => [
        `files/entry-${String(index).padStart(4, '0')}.txt`,
        `value-${String(index)}`,
      ]),
    ),
  );

  const summary = await extractZip(archive, destination);

  expect(summary.entryCount).toBe(entryCount);
  expect(
    await readFile(path.join(destination, 'files/entry-2047.txt'), 'utf8'),
  ).toBe('value-2047');
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
