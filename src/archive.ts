import { createWriteStream } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import yauzl, { type Entry, type ZipFile } from 'yauzl';

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 20_000;
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024;

export interface ArchiveSummary {
  entryCount: number;
  totalUncompressedBytes: number;
}

export async function inspectZip(filePath: string): Promise<ArchiveSummary> {
  const archive = await open(filePath, 'r');
  try {
    const stats = await archive.stat();
    if (stats.size > MAX_ARCHIVE_BYTES) {
      throw new Error('The archive exceeds the 512 MiB compressed-size limit.');
    }
  } finally {
    await archive.close();
  }

  const zip = await openZip(filePath);
  try {
    let entryCount = 0;
    let totalUncompressedBytes = 0;
    for await (const entry of entries(zip)) {
      validateEntry(entry);
      entryCount += 1;
      totalUncompressedBytes += entry.uncompressedSize;
      if (entryCount > MAX_ENTRIES) {
        throw new Error(`The archive exceeds ${String(MAX_ENTRIES)} entries.`);
      }
      if (totalUncompressedBytes > MAX_EXPANDED_BYTES) {
        throw new Error('The archive exceeds the 1 GiB expanded-size limit.');
      }
    }
    return { entryCount, totalUncompressedBytes };
  } finally {
    zip.close();
  }
}

export async function readZipEntry(
  filePath: string,
  entryName: string,
  maximumBytes = 5 * 1024 * 1024,
): Promise<Buffer> {
  const zip = await openZip(filePath);
  try {
    for await (const entry of entries(zip)) {
      validateEntry(entry);
      if (entry.fileName !== entryName) continue;
      if (isDirectory(entry)) {
        throw new Error(`Archive entry ${entryName} is a directory.`);
      }
      if (entry.uncompressedSize > maximumBytes) {
        throw new Error(`Archive entry ${entryName} exceeds its size limit.`);
      }
      return await readEntry(zip, entry, maximumBytes);
    }
  } finally {
    zip.close();
  }
  throw new Error(`Archive entry ${entryName} is missing.`);
}

export async function extractZip(
  filePath: string,
  destination: string,
): Promise<ArchiveSummary> {
  const summary = await inspectZip(filePath);
  await mkdir(destination, { recursive: true });
  const canonicalDestination = path.resolve(destination);
  const zip = await openZip(filePath);
  try {
    for await (const entry of entries(zip)) {
      validateEntry(entry);
      const target = safeArchiveTarget(canonicalDestination, entry.fileName);
      if (isDirectory(entry)) {
        await mkdir(target, { recursive: true });
        continue;
      }
      await mkdir(path.dirname(target), { recursive: true });
      await writeEntry(zip, entry, target);
    }
  } finally {
    zip.close();
  }
  return summary;
}

export async function readJsonZipEntry(
  filePath: string,
  entryName: string,
): Promise<unknown> {
  const bytes = await readZipEntry(filePath, entryName);
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error(`Archive entry ${entryName} is not valid JSON.`);
  }
}

function openZip(filePath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      filePath,
      { lazyEntries: true, autoClose: false },
      (error, zip) => {
        if (error) reject(error);
        else resolve(zip);
      },
    );
  });
}

async function* entries(zip: ZipFile): AsyncGenerator<Entry> {
  const queue: Entry[] = [];
  let done = false;
  const state: { failure: Error | null } = { failure: null };
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  zip.on('entry', (entry: Entry) => {
    queue.push(entry);
    notify();
  });
  zip.once('end', () => {
    done = true;
    notify();
  });
  zip.once('error', (error: Error) => {
    state.failure = error;
    done = true;
    notify();
  });
  zip.readEntry();
  while (!done || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      continue;
    }
    const entry = queue.shift();
    if (!entry) continue;
    yield entry;
    zip.readEntry();
  }
  if (state.failure !== null) throw state.failure;
}

function validateEntry(entry: Entry): void {
  if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
    throw new Error(`Encrypted ZIP entry is not allowed: ${entry.fileName}`);
  }
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
    throw new Error(`ZIP entry exceeds 256 MiB: ${entry.fileName}`);
  }
  safeArchiveTarget('/archive-root', entry.fileName);
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const fileType = unixMode & 0o170000;
  if (fileType === 0o120000) {
    throw new Error(`Symbolic links are not allowed: ${entry.fileName}`);
  }
}

function safeArchiveTarget(destination: string, entryName: string): string {
  if (
    entryName.length === 0 ||
    entryName.includes('\0') ||
    entryName.includes('\\') ||
    entryName.startsWith('/') ||
    /^[A-Za-z]:/u.test(entryName)
  ) {
    throw new Error(`Unsafe ZIP entry path: ${entryName}`);
  }
  const segments = entryName.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw new Error(`Unsafe ZIP entry path: ${entryName}`);
  }
  const target = path.resolve(destination, ...segments);
  if (
    target !== destination &&
    !target.startsWith(`${destination}${path.sep}`)
  ) {
    throw new Error(`Unsafe ZIP entry path: ${entryName}`);
  }
  return target;
}

function isDirectory(entry: Entry): boolean {
  return entry.fileName.endsWith('/');
}

function openReadStream(
  zip: ZipFile,
  entry: Entry,
): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) reject(error);
      else resolve(stream);
    });
  });
}

async function readEntry(
  zip: ZipFile,
  entry: Entry,
  maximumBytes: number,
): Promise<Buffer> {
  const stream = await openReadStream(zip, entry);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > maximumBytes) {
      throw new Error(
        `Archive entry ${entry.fileName} exceeds its size limit.`,
      );
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}

async function writeEntry(
  zip: ZipFile,
  entry: Entry,
  target: string,
): Promise<void> {
  const input = await openReadStream(zip, entry);
  const output = createWriteStream(target, { flags: 'wx', mode: 0o600 });
  await new Promise<void>((resolve, reject) => {
    input.once('error', reject);
    output.once('error', reject);
    output.once('finish', resolve);
    input.pipe(output);
  });
}
