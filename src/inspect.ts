import { stat } from 'node:fs/promises';
import { z } from 'zod';
import { inspectZip, readJsonZipEntry } from './archive.js';
import { sha256File } from './digest.js';
import type { ExtensionClassification, VsixInspection } from './types.js';

const extensionManifestSchema = z.looseObject({
  publisher: z.string().trim().min(1).max(256),
  name: z.string().trim().min(1).max(256),
  version: z.string().trim().min(1).max(128),
  displayName: z.string().max(512).optional(),
  main: z.string().max(2048).optional(),
  browser: z.string().max(2048).optional(),
  activationEvents: z.array(z.string().max(1024)).max(4096).optional(),
  extensionDependencies: z.array(z.string().max(256)).max(1024).optional(),
  extensionPack: z.array(z.string().max(256)).max(1024).optional(),
  contributes: z.record(z.string(), z.unknown()).optional(),
});

export async function inspectVsix(filePath: string): Promise<VsixInspection> {
  const [summary, archiveSha256, archiveStats, rawManifest] = await Promise.all(
    [
      inspectZip(filePath),
      sha256File(filePath),
      stat(filePath),
      readJsonZipEntry(filePath, 'extension/package.json'),
    ],
  );
  const manifest = extensionManifestSchema.parse(rawManifest);
  const classification = classifyExtension(manifest);
  return {
    archiveSha256,
    archiveBytes: archiveStats.size,
    entryCount: summary.entryCount,
    totalUncompressedBytes: summary.totalUncompressedBytes,
    extension: {
      id: `${manifest.publisher}.${manifest.name}`,
      publisher: manifest.publisher,
      name: manifest.name,
      version: manifest.version,
      displayName: manifest.displayName ?? null,
      main: manifest.main ?? null,
      browser: manifest.browser ?? null,
      activationEvents: manifest.activationEvents ?? [],
      extensionDependencies: manifest.extensionDependencies ?? [],
      extensionPack: manifest.extensionPack ?? [],
    },
    classification,
    findings: buildFindings(manifest, classification),
  };
}

export function classifyExtension(manifest: {
  main?: string | undefined;
  browser?: string | undefined;
  contributes?: Record<string, unknown> | undefined;
}): ExtensionClassification {
  if (manifest.browser) return 'browser-extension-host';
  if (manifest.main) return 'node-extension-host';
  if (hasWebviewContribution(manifest.contributes)) return 'static-webview';
  return 'declarative-only';
}

function hasWebviewContribution(
  contributes: Record<string, unknown> | undefined,
): boolean {
  if (!contributes) return false;
  return ['customEditors', 'views', 'viewsContainers', 'webviewPanel'].some(
    (key) => Object.hasOwn(contributes, key),
  );
}

function buildFindings(
  manifest: {
    main?: string | undefined;
    browser?: string | undefined;
    activationEvents?: string[] | undefined;
    extensionDependencies?: string[] | undefined;
    extensionPack?: string[] | undefined;
  },
  classification: ExtensionClassification,
): string[] {
  const findings: string[] = [];
  if (classification === 'node-extension-host') {
    findings.push(
      'The extension declares a Node extension host entry point; it must not be executed during conversion.',
    );
  }
  if (manifest.browser) {
    findings.push(
      'The extension declares a browser extension host entry point; compatibility requires an explicit adapter.',
    );
  }
  if ((manifest.activationEvents?.length ?? 0) > 0) {
    findings.push('The extension declares activation events.');
  }
  if ((manifest.extensionDependencies?.length ?? 0) > 0) {
    findings.push('The extension depends on other extensions.');
  }
  if ((manifest.extensionPack?.length ?? 0) > 0) {
    findings.push('The extension bundles an extension pack.');
  }
  return findings;
}
