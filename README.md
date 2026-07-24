# `@theaiplatform/openvsx-port`

Generic, security-bounded intake and conversion orchestration for turning a
pinned Visual Studio Code/OpenVSX extension into a reviewed The AI Platform
miniapp release.

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
npx --yes @theaiplatform/openvsx-port@0.1.8 inspect ./extension.vsix

npx --yes @theaiplatform/openvsx-port@0.1.8 convert \
  --config openvsx/example/visual-editor/tap.openvsx.json

npx --yes @theaiplatform/openvsx-port@0.1.8 verify \
  --config openvsx/example/visual-editor/tap.openvsx.json
```

Use `--source ./extension.vsix` to replace the configured OpenVSX download with
a local archive while retaining the recipe's identity, version, and digest
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
- `TAP_OPENVSX_OUTPUT_TARBALL`

The adapter owns final miniapp source generation and target compilation through
the public miniapp SDK. It must write exactly the declared npm tarball. The
converter owns the compatibility report and conversion attestation after that
step succeeds.

This separation keeps VSIX parsing out of the runtime SDK, keeps partner
conversion behavior out of the desktop application, and lets partners, TAP CI,
and local developers run the same pinned command.

## Library API

The ESM package exports:

- `loadPortConfig`
- `openVsxDownloadUrl` and `acquireFile`
- `inspectZip`, `extractZip`, `readZipEntry`, and `readJsonZipEntry`
- `inspectVsix` and `classifyExtension`
- `convertOpenVsxExtension`
- `verifyConversionOutputs`
- SHA-256 helpers and public TypeScript types

## npm publication

The package is configured for public npmjs publication with provenance. Release
automation builds, tests, dry-packs, and publishes through npm Trusted
Publishing; no long-lived npm token belongs in this repository.
