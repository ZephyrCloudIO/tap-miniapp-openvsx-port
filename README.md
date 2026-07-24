# `@theaiplatform/openvsx-port`

Generic, security-bounded intake and conversion orchestration for turning a
pinned Visual Studio Code extension from Open VSX, Visual Studio Marketplace,
or a local upload into a reviewed The AI Platform miniapp release.

The canonical source is
[`ZephyrCloudIO/tap-miniapp-openvsx-port`](https://github.com/ZephyrCloudIO/tap-miniapp-openvsx-port).
The supported distribution is the public npm package
[`@theaiplatform/openvsx-port`](https://www.npmjs.com/package/@theaiplatform/openvsx-port).

## Security boundary

The converter never imports, launches, or executes code from the uploaded
extension. It:

1. downloads or copies immutable inputs;
2. verifies their pinned SHA-256 digests;
3. rejects encrypted, traversing, symlinked, oversized, and over-expanded ZIP
   inputs;
4. parses `extension/package.json` as bounded data;
5. extracts inputs into a disposable `.tap-openvsx-build` directory;
6. invokes only the exact trusted adapter package and version declared in the
   reviewed recipe; and
7. verifies and attests the adapter's npm tarball.

The extension and the trusted build adapter are different trust domains. A
recipe must never point `conversion.adapter` at a package supplied by an
unreviewed extension upload.

## Install and run

```sh
npx --yes @theaiplatform/openvsx-port@0.1.11 inspect ./extension.vsix

npx --yes @theaiplatform/openvsx-port@0.1.11 convert \
  --config openvsx/example/visual-editor/tap.openvsx.json

npx --yes @theaiplatform/openvsx-port@0.1.11 verify \
  --config openvsx/example/visual-editor/tap.openvsx.json
```

Recipes can pin an `openvsx` or `visualstudio-marketplace` source. Use
`--source ./extension.vsix` to replace the configured registry download with a
local upload while retaining the recipe's identity, version, and digest
checks. Use `--skip-adapter` only to inspect and stage inputs; it deliberately
does not create a publishable tarball.

Relative working and output paths are resolved from the current project
directory, so run the command from the repository root that owns the recipe.
The recipe itself may live in a nested `openvsx/<publisher>/<extension>`
directory.

## Recipe ownership

Partner recipes belong outside this repository, conventionally at:

```text
openvsx/<publisher>/<extension>/tap.openvsx.json
```

Only reviewed facts that cannot be derived safely from the extension belong
there: immutable auxiliary assets, TAP package identity, requested surfaces,
permissions, network origins, document/session policy, publishing ownership,
and a version-pinned trusted adapter.

The converter repository contains no partner identity, endpoint, permission,
template, or special case.

## Trusted adapter contract

`convert` starts the pinned adapter with `npm exec --package
<package>@<version> -- <binary>`. It uses argument arrays rather than a shell
and supplies these absolute paths:

- `TAP_OPENVSX_CONFIG`
- `TAP_OPENVSX_RESOLVED_CONFIG`
- `TAP_OPENVSX_WORKING_DIRECTORY`
- `TAP_OPENVSX_EXTENSION_ARCHIVE`
- `TAP_OPENVSX_EXTENSION_DIRECTORY`
- `TAP_OPENVSX_WEBVIEW_ARCHIVE` when declared
- `TAP_OPENVSX_WEBVIEW_DIRECTORY` when declared
- `TAP_OPENVSX_WEBVIEW_ROOT_DIRECTORY` when declared
- `TAP_OPENVSX_OUTPUT_TARBALL`

The adapter owns final miniapp source generation and target compilation through
the public miniapp SDK. It must write exactly the declared npm tarball. The
converter owns the compatibility report and conversion attestation after that
step succeeds.

When a VSIX already contains a browser build, declare
`conversion.webview.source` as `extension` and point `root` and `entry` at the
files below the extracted VSIX root. The converter validates the path and
provides its extracted source directory and resolved root to the adapter as
`TAP_OPENVSX_WEBVIEW_DIRECTORY` and
`TAP_OPENVSX_WEBVIEW_ROOT_DIRECTORY`. External, digest-pinned webview archives
remain supported for extensions that publish their browser build separately.

This separation keeps VSIX parsing out of the runtime SDK, keeps partner
conversion behavior out of the desktop application, and lets partners, TAP CI,
and local developers run the same pinned command.

## Library API

The ESM package exports:

- `loadPortConfig`
- `extensionDownloadUrl`, `openVsxDownloadUrl`,
  `visualStudioMarketplaceDownloadUrl`, and `acquireFile`
- `inspectZip`, `extractZip`, `readZipEntry`, and `readJsonZipEntry`
- `inspectVsix` and `classifyExtension`
- `convertOpenVsxExtension`
- `verifyConversionOutputs`
- SHA-256 helpers and public TypeScript types

## npm publication

The package is configured for public npmjs publication with provenance. Release
automation builds, tests, dry-packs, and publishes through npm Trusted
Publishing; no long-lived npm token belongs in this repository.
