import { expect, it } from '@rstest/core';
import {
  extensionDownloadUrl,
  openVsxDownloadUrl,
  visualStudioMarketplaceDownloadUrl,
} from './source.js';

it('builds an immutable Open VSX download URL', () => {
  const source = {
    provider: 'openvsx' as const,
    registryUrl: 'https://open-vsx.org',
    extensionId: 'example.extension',
    version: '1.2.3',
    sha256: 'a'.repeat(64),
  };
  expect(openVsxDownloadUrl(source)).toBe(
    'https://open-vsx.org/api/example/extension/1.2.3/file/example.extension-1.2.3.vsix',
  );
  expect(extensionDownloadUrl(source)).toBe(openVsxDownloadUrl(source));
});

it('builds an immutable Visual Studio Marketplace download URL', () => {
  const source = {
    provider: 'visualstudio-marketplace' as const,
    registryUrl: 'https://marketplace.visualstudio.com' as const,
    extensionId: 'pomdtr.excalidraw-editor',
    version: '3.9.3',
    sha256: 'a'.repeat(64),
  };
  expect(visualStudioMarketplaceDownloadUrl(source)).toBe(
    'https://marketplace.visualstudio.com/_apis/public/gallery/publishers/pomdtr/vsextensions/excalidraw-editor/3.9.3/vspackage',
  );
  expect(extensionDownloadUrl(source)).toBe(
    visualStudioMarketplaceDownloadUrl(source),
  );
});
