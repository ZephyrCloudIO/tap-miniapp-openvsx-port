import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type {
  ExtensionSourceConfig,
  OpenVsxSourceConfig,
  VisualStudioMarketplaceSourceConfig,
} from './types.js';

const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export function openVsxDownloadUrl(source: OpenVsxSourceConfig): string {
  const [publisher, name] = source.extensionId.split('.');
  if (!publisher || !name) {
    throw new Error(
      'The OpenVSX extension ID must contain publisher and name.',
    );
  }
  const base = new URL(source.registryUrl);
  const basePath = base.pathname.endsWith('/')
    ? base.pathname
    : `${base.pathname}/`;
  base.pathname = `${basePath}api/${encodeURIComponent(publisher)}/${encodeURIComponent(
    name,
  )}/${encodeURIComponent(source.version)}/file/${encodeURIComponent(
    `${publisher}.${name}-${source.version}.vsix`,
  )}`;
  base.search = '';
  base.hash = '';
  return base.toString();
}

export function visualStudioMarketplaceDownloadUrl(
  source: VisualStudioMarketplaceSourceConfig,
): string {
  const [publisher, name] = splitExtensionId(source.extensionId);
  const base = new URL(source.registryUrl);
  base.pathname = [
    '_apis',
    'public',
    'gallery',
    'publishers',
    encodeURIComponent(publisher),
    'vsextensions',
    encodeURIComponent(name),
    encodeURIComponent(source.version),
    'vspackage',
  ].join('/');
  base.search = '';
  base.hash = '';
  return base.toString();
}

export function extensionDownloadUrl(source: ExtensionSourceConfig): string {
  switch (source.provider) {
    case 'openvsx':
      return openVsxDownloadUrl(source);
    case 'visualstudio-marketplace':
      return visualStudioMarketplaceDownloadUrl(source);
  }
}

export async function acquireFile(
  input: string,
  destination: string,
): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  if (!isHttpUrl(input)) {
    const source = path.resolve(input);
    const sourceStats = await stat(source);
    if (!sourceStats.isFile())
      throw new Error(`Input is not a file: ${source}`);
    if (sourceStats.size > MAX_DOWNLOAD_BYTES) {
      throw new Error('The local input exceeds 512 MiB.');
    }
    await copyFile(source, destination);
    return;
  }
  await download(input, destination, 0);
}

async function download(
  input: string,
  destination: string,
  redirects: number,
): Promise<void> {
  if (redirects > MAX_REDIRECTS) {
    throw new Error('The download exceeded five redirects.');
  }
  const response = await fetch(input, {
    redirect: 'manual',
    signal: AbortSignal.timeout(120_000),
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) throw new Error('The download redirect has no location.');
    const next = new URL(location, input);
    if (next.protocol !== 'https:') {
      throw new Error('Downloads may redirect only to HTTPS URLs.');
    }
    await download(next.toString(), destination, redirects + 1);
    return;
  }
  if (!response.ok || !response.body) {
    throw new Error(`Download failed with HTTP ${String(response.status)}.`);
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
    throw new Error('The download exceeds 512 MiB.');
  }
  let received = 0;
  const bounded = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > MAX_DOWNLOAD_BYTES) {
          controller.error(new Error('The download exceeds 512 MiB.'));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  await pipeline(
    Readable.fromWeb(bounded as never),
    createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (url.username || url.password) {
      throw new Error('Download URLs must not contain credentials.');
    }
    if (url.protocol !== 'https:' && !isLoopback(url.hostname)) {
      throw new Error('Remote downloads require HTTPS.');
    }
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Download URL')) {
      throw error;
    }
    return false;
  }
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  );
}

function splitExtensionId(extensionId: string): [string, string] {
  const [publisher, name] = extensionId.split('.');
  if (!publisher || !name) {
    throw new Error('The extension ID must contain publisher and name.');
  }
  return [publisher, name];
}
