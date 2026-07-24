# Release process

`@theaiplatform/openvsx-port` is published to the public npm registry by the
manually dispatched [`Publish npm package`](../.github/workflows/publish.yml)
workflow. There is no automatic publish on push or tag.

## Channels

The workflow has one input, `release_channel`, with two options:

| Channel  | Version                        | dist-tag | Source                                     |
| -------- | ------------------------------ | -------- | ------------------------------------------ |
| `canary` | `0.0.0-<sanitized-branch>.<N>` | `canary` | Computed per branch, `<N>` auto-increments |
| `latest` | the `package.json` version     | `latest` | Must be a clean stable `x.y.z`             |

- **canary** is the default. `<N>` is the highest already-published
  `0.0.0-<branch>.<N>` plus one (or `1` for a branch's first canary), so every
  canary is immutable and addressable by its exact version. The branch name is
  lowercased and non-`[0-9a-z-]` characters collapse to `-`
  (e.g. `feat/Foo_Bar` -> `feat-foo-bar`).
- **latest** publishes the exact version in `package.json`. Bump it in a PR
  first; the workflow fails fast if that version is already published.

Version and dist-tag are resolved by
[`scripts/compute-npmjs-version.mjs`](../scripts/compute-npmjs-version.mjs).

## How to publish

1. Merge (or push) the code you want to release.
2. In GitHub, open **Actions -> Publish npm package -> Run workflow**.
3. Choose the `release_channel` and confirm the `branch`.
4. Approve the run at the `npmjs-approval` gate (see below).

The run name shows the channel and branch so the reviewer approves exactly what
is being published.

## Pipeline

The workflow runs two jobs:

1. **`prepare`** (environment `npmjs-approval`) — requires reviewer approval
   before anything runs. It computes the version/dist-tag, fails fast if a
   `latest` version already exists, runs `pnpm check`, sets the publish version,
   packs the exact tarball, records its SHA-256, and uploads it as an artifact.
2. **`publish`** (environment `npmjs`) — restores the artifact, verifies its
   SHA-256 matches the one `prepare` recorded, then publishes that exact tarball
   with `--provenance` and the resolved dist-tag.

Splitting approval (`prepare`) from credentials (`publish`) means a dispatch is
approved once, up front, and only the verified tarball is ever published.

## Authentication

Publication uses **npm Trusted Publishing (OIDC)** — no static npm token is
stored or used. The `publish` job runs with `id-token: write` in the OIDC-bound
`npmjs` environment, and npm mints a short-lived, workflow-scoped token.

## Required GitHub environments

Configure these once in **Settings -> Environments**:

- **`npmjs-approval`** — add a required reviewer. No secrets. This is the human
  approval gate.
- **`npmjs`** — configure the npm package's trusted publisher for this
  repository/workflow. No required reviewer (approval already happened on
  `prepare`), no secrets.

## Concurrency

Runs are serialized per channel (`npmjs-openvsx-port-<channel>`) so concurrent
dispatches cannot compute or publish the same version.
