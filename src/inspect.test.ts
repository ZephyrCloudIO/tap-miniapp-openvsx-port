import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from '@rstest/core';
import yazl from 'yazl';
import { inspectVsix } from './inspect.js';
import { inspectZip } from './archive.js';

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
    }),
    'extension/dist/browser.js': 'throw new Error("must never execute");',
  });
  const result = await inspectVsix(archive);
  expect(result.extension.id).toBe('example.visual-editor');
  expect(result.classification).toBe('browser-extension-host');
  expect(result.findings.join(' ')).toMatch(/explicit adapter/u);
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
