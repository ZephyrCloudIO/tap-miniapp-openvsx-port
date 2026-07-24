import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import unzipper, {
  type CentralDirectory,
  type File as ZipEntry,
} from 'unzipper';

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 20_000;
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024;

export interface ArchiveSummary {
  entryCount: number;
  totalUncompressedBytes: number;
}

export async function inspectZip(filePath: string): Promise<ArchiveSummary> {
  const directory = await openArchive(filePath);
  return summarizeEntries(directory.files);
}

export async function readZipEntry(
  filePath: string,
  entryName: string,
  maximumBytes = 5 * 1024 * 1024,
): Promise<Buffer> {
  const directory = await openArchive(filePath);
  summarizeEntries(directory.files);
  const entry = directory.files.find(
    (candidate) => candidate.path === entryName,
  );
  if (!entry) {
    throw new Error(`Archive entry ${entryName} is missing.`);
  }
  if (isDirectory(entry)) {
    throw new Error(`Archive entry ${entryName} is a directory.`);
  }
  if (entry.uncompressedSize > maximumBytes) {
    throw new Error(`Archive entry ${entryName} exceeds its size limit.`);
  }
  return await readEntry(entry, maximumBytes);
}

export async function extractZip(
  filePath: string,
  destination: string,
): Promise<ArchiveSummary> {
  const directory = await openArchive(filePath);
  const summary = summarizeEntries(directory.files);
  await mkdir(destination, { recursive: true });
  const canonicalDestination = path.resolve(destination);
  for (const entry of directory.files) {
    const target = safeArchiveTarget(canonicalDestination, entry.path);
    if (isDirectory(entry)) {
      await mkdir(target, { recursive: true });
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeEntry(entry, target);
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

async function openArchive(filePath: string): Promise<CentralDirectory> {
  const stats = await stat(filePath);
  if (!stats.isFile()) {
    throw new Error('The archive input is not a regular file.');
  }
  if (stats.size > MAX_ARCHIVE_BYTES) {
    throw new Error('The archive exceeds the 512 MiB compressed-size limit.');
  }
  return await unzipper.Open.file(filePath);
}

function summarizeEntries(entries: ZipEntry[]): ArchiveSummary {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`The archive exceeds ${String(MAX_ENTRIES)} entries.`);
  }
  const paths = new Set<string>();
  let totalUncompressedBytes = 0;
  for (const entry of entries) {
    validateEntry(entry);
    if (paths.has(entry.path)) {
      throw new Error(`Duplicate ZIP entry path is not allowed: ${entry.path}`);
    }
    paths.add(entry.path);
    totalUncompressedBytes += entry.uncompressedSize;
    if (totalUncompressedBytes > MAX_EXPANDED_BYTES) {
      throw new Error('The archive exceeds the 1 GiB expanded-size limit.');
    }
  }
  return {
    entryCount: entries.length,
    totalUncompressedBytes,
  };
}

function validateEntry(entry: ZipEntry): void {
  if ((entry.flags & 0x1) !== 0) {
    throw new Error(`Encrypted ZIP entry is not allowed: ${entry.path}`);
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw new Error(
      `Unsupported ZIP compression method ${String(entry.compressionMethod)}: ${entry.path}`,
    );
  }
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
    throw new Error(`ZIP entry exceeds 256 MiB: ${entry.path}`);
  }
  safeArchiveTarget('/archive-root', entry.path);
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const fileType = unixMode & 0o170000;
  if (fileType === 0o120000) {
    throw new Error(`Symbolic links are not allowed: ${entry.path}`);
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
  const normalizedSegments = segments.filter((segment) => segment.length > 0);
  if (
    normalizedSegments.length === 0 ||
    normalizedSegments.some((segment) => segment === '..' || segment === '.')
  ) {
    throw new Error(`Unsafe ZIP entry path: ${entryName}`);
  }
  const target = path.resolve(destination, ...normalizedSegments);
  if (
    target !== destination &&
    !target.startsWith(`${destination}${path.sep}`)
  ) {
    throw new Error(`Unsafe ZIP entry path: ${entryName}`);
  }
  return target;
}

function isDirectory(entry: ZipEntry): boolean {
  return entry.type === 'Directory' || entry.path.endsWith('/');
}

async function readEntry(
  entry: ZipEntry,
  maximumBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of entry.stream()) {
    const bytes = archiveChunk(chunk);
    total += bytes.byteLength;
    if (total > maximumBytes) {
      throw new Error(`Archive entry ${entry.path} exceeds its size limit.`);
    }
    chunks.push(bytes);
  }
  assertExpandedSize(entry, total);
  return Buffer.concat(chunks, total);
}

function archiveChunk(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array || typeof chunk === 'string') {
    return Buffer.from(chunk);
  }
  throw new Error('The archive stream emitted an unsupported chunk type.');
}

async function writeEntry(entry: ZipEntry, target: string): Promise<void> {
  const limiter = byteLimit(entry);
  const output = createWriteStream(target, { flags: 'wx', mode: 0o600 });
  await pipeline(entry.stream(), limiter, output);
}

function byteLimit(entry: ZipEntry): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.byteLength;
      if (total > MAX_ENTRY_BYTES) {
        callback(new Error(`ZIP entry exceeds 256 MiB: ${entry.path}`));
        return;
      }
      callback(null, chunk);
    },
    flush(callback) {
      try {
        assertExpandedSize(entry, total);
        callback();
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });
}

function assertExpandedSize(entry: ZipEntry, actualBytes: number): void {
  if (actualBytes !== entry.uncompressedSize) {
    throw new Error(
      `ZIP entry size does not match its central directory metadata: ${entry.path}`,
    );
  }
}
