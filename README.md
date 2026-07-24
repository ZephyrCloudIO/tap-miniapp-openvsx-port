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
6. compiles a bounded declarative static-webview adapter, or invokes only the
   exact trusted external adapter package and version declared in the reviewed
   recipe; and
7. verifies and attests the adapter's npm tarball.

The extension and the trusted build adapter are different trust domains. A
recipe must never point `conversion.adapter` at a package supplied by an
unreviewed extension upload.

## Install and run

```sh
npx --yes @theaiplatform/openvsx-port@0.1.13 inspect ./extension.vsix

npx --yes @theaiplatform/openvsx-port@0.1.13 convert \
  --config openvsx/example/visual-editor/tap.openvsx.json

npx --yes @theaiplatform/openvsx-port@0.1.13 verify \
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
and any facts required by either the built-in declarative adapter or a
version-pinned trusted external adapter.

The converter repository contains no partner identity, endpoint, permission,
template, or special case.

## Built-in static-webview adapter

For extensions that already ship a browser bundle, `convert` can generate and
compile the TAP miniapp directly. The recipe declares
`conversion.webview.entry`, a `vscode-custom-editor` bridge, its initial
bootstrap JSON, and storage or session mappings. The generated outer surface
uses `@theaiplatform/miniapp-sdk` as the only authority boundary:

- configured VS Code messages persist through `sdk.storage`;
- the iframe's synchronous `localStorage` compatibility facade persists
  through workspace- and installation-scoped `sdk.session`;
- declared exact HTTPS origins use `sdk.http`; and
- undeclared origins and unsupported host operations fail closed.

The imported webview remains in a sandboxed iframe and never receives a host
transport or native credential. Generated UI surfaces declare only their
storage, session, and HTTP effects; they do not require a synthetic
surface-level permission action. This keeps workspace and channel surfaces
discoverable while the host still enforces every declared effect.

`rebaseRootPaths` can rewrite browser-root asset references such as
`/assets/...` relative to each emitted HTML, CSS, or JavaScript file. Literal
`replacements` handle reviewed build placeholders and can be limited to
explicit file globs. If an upstream browser bundle references static resources
that it did not ship, `webview.assets` downloads each recipe-pinned URL,
verifies its SHA-256 digest, rejects collisions and path traversal, and vendors
it beneath the emitted webview root. Fonts, stylesheets, images, and other
browser-managed subresources must use this static path; they cannot be sent
through `sdk.http`.

These are generic recipe instructions; partner identity and endpoints remain
outside this repository. During conversion, executable inline scripts are
emitted as same-origin files so the webview works under TAP's strict package
CSP; inline event handlers and `javascript:` URLs fail conversion. A reviewed
replacement can use the SDK's immutable
`window.__TAP_VSCODE_WEBVIEW_ASSET_BASE_URL__` value when an upstream bundle
requires its webview asset directory at runtime.

## Trusted external adapter contract

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

An external adapter owns final miniapp source generation and target compilation
through the public miniapp SDK. It must write exactly the declared npm tarball.
The converter owns the compatibility report and conversion attestation after
that step succeeds.

When a VSIX already contains a browser build, declare
`conversion.webview.source` as `extension` and point `root` and `entry` at the
files below the extracted VSIX root. The converter validates the path and
provides its extracted source directory and resolved root to an external
adapter as
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
