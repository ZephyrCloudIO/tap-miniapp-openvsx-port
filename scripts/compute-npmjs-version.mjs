#!/usr/bin/env node
/**
 * Computes the exact npm version and dist-tag for a manually dispatched public
 * release of @theaiplatform/openvsx-port. One workflow, two channels:
 *
 *   canary -> 0.0.0-<sanitized-branch>.<N> on the shared `canary` dist-tag.
 *             <N> accumulates per branch: the highest already-published
 *             0.0.0-<branch>.<N> plus one, or 1 when the branch has none.
 *   latest -> the clean stable version from package.json on the `latest`
 *             dist-tag.
 *
 * Every canary shares the one `canary` dist-tag; the branch name and per-branch
 * counter live in the immutable version, so any canary stays addressable by its
 * exact version.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

export const PACKAGE_NAME = '@theaiplatform/openvsx-port';
export const NPM_REGISTRY = 'https://registry.npmjs.org';

const STABLE_VERSION_PATTERN =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const RELEASE_CHANNELS = new Set(['canary', 'latest']);

/**
 * Reduces a git branch name to a semver-safe prerelease identifier: lowercase,
 * every character outside [0-9a-z-] becomes `-`, repeated `-` collapse, and any
 * leading/trailing `-` is trimmed. e.g. `feat/Foo_Bar` -> `feat-foo-bar`.
 */
export function sanitizeBranchName(branch) {
  const sanitized = String(branch ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-z-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (sanitized === '') {
    throw new Error(
      `A branch name is required and must contain at least one [0-9a-z] character; received ${JSON.stringify(branch)}.`,
    );
  }
  return sanitized;
}

/**
 * Given every published version of the package, returns the next per-branch
 * canary counter: the highest N across `0.0.0-<branch>.<N>` plus one, or 1 when
 * the branch has never published a canary.
 */
export function computeNextCanaryNumber(publishedVersions, branch) {
  const prefix = `0.0.0-${branch}.`;
  let highest = 0;
  for (const version of publishedVersions ?? []) {
    if (typeof version !== 'string' || !version.startsWith(prefix)) continue;
    const suffix = version.slice(prefix.length);
    if (!/^[0-9]+$/u.test(suffix)) continue;
    const candidate = Number.parseInt(suffix, 10);
    if (candidate > highest) highest = candidate;
  }
  return highest + 1;
}

export function computeDispatchVersionInfo({
  channel,
  branch,
  packageVersion,
  publishedVersions,
}) {
  if (!RELEASE_CHANNELS.has(channel)) {
    throw new Error(
      `Unsupported release channel ${JSON.stringify(channel)}; expected one of ${[...RELEASE_CHANNELS].join(', ')}.`,
    );
  }

  if (channel === 'latest') {
    if (!STABLE_VERSION_PATTERN.test(String(packageVersion ?? ''))) {
      throw new Error(
        `A clean stable package.json version is required for the latest channel; received ${JSON.stringify(packageVersion)}.`,
      );
    }
    // The "already published" fail-fast check lives inline in the prepare job
    // so it is not computed twice; `npm publish` also rejects duplicates.
    return { version: packageVersion, tag: 'latest' };
  }

  const sanitizedBranch = sanitizeBranchName(branch);
  const next = computeNextCanaryNumber(publishedVersions, sanitizedBranch);
  return { version: `0.0.0-${sanitizedBranch}.${next}`, tag: 'canary' };
}

/**
 * Fetches every published version of the package. A brand-new package the
 * registry has never seen (E404) is treated as an empty history.
 */
export function fetchPublishedVersions() {
  try {
    const output = execFileSync(
      'npm',
      [
        'view',
        PACKAGE_NAME,
        'versions',
        '--json',
        `--registry=${NPM_REGISTRY}`,
      ],
      { encoding: 'utf8' },
    ).trim();
    if (output === '') return [];
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) return parsed;
    return typeof parsed === 'string' ? [parsed] : [];
  } catch (error) {
    const detail = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
    if (/\bE404\b|is not in this registry|No match found/iu.test(detail)) {
      return [];
    }
    throw new Error(`npm view failed: ${detail.trim() || error.message}`);
  }
}

function main() {
  const channel = (process.env.RELEASE_CHANNEL ?? '').trim();
  const branch = process.env.BRANCH_NAME ?? '';
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );

  // Only canary needs the published version list, to derive its next per-branch
  // counter. The latest "already published" check runs inline in the prepare
  // job instead, so it is not fetched/computed here too.
  const publishedVersions =
    channel === 'canary' ? fetchPublishedVersions() : [];

  const result = computeDispatchVersionInfo({
    channel,
    branch,
    packageVersion: manifest.version,
    publishedVersions,
  });

  process.stdout.write(
    `npmjs version: ${result.version} (tag: ${result.tag})\n`,
  );
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `tag=${result.tag}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
