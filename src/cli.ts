#!/usr/bin/env node

import { resolve } from 'node:path';
import { convertOpenVsxExtension, verifyConversionOutputs } from './convert.js';
import { inspectVsix } from './inspect.js';
import { CONVERTER_VERSION } from './version.js';

interface ParsedArgs {
  command: string;
  values: Map<string, string>;
  flags: Set<string>;
  positionals: string[];
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  switch (parsed.command) {
    case 'inspect': {
      const source = parsed.positionals[0] ?? parsed.values.get('source');
      if (!source) throw new Error('inspect requires a VSIX path.');
      const result = await inspectVsix(resolve(source));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    case 'convert': {
      const config = requiredValue(parsed, 'config');
      const result = await convertOpenVsxExtension({
        config,
        ...(parsed.values.has('source')
          ? { source: requiredValue(parsed, 'source') }
          : {}),
        skipAdapter: parsed.flags.has('skip-adapter'),
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    case 'verify': {
      await verifyConversionOutputs(requiredValue(parsed, 'config'));
      process.stdout.write('OpenVSX conversion outputs verified.\n');
      return;
    }
    case 'help':
    case '--help':
    case '-h':
    case '':
      printHelp();
      return;
    case 'version':
    case '--version':
    case '-v':
      process.stdout.write(`${CONVERTER_VERSION}\n`);
      return;
    default:
      throw new Error(`Unknown command: ${parsed.command}`);
  }
}

function parseArgs(args: string[]): ParsedArgs {
  const [command = '', ...rest] = args;
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const positionals: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token) continue;
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const name = token.slice(2);
    if (name === 'skip-adapter') {
      flags.add(name);
      continue;
    }
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Option --${name} requires a value.`);
    }
    values.set(name, value);
    index += 1;
  }
  return { command, values, flags, positionals };
}

function requiredValue(parsed: ParsedArgs, name: string): string {
  const value = parsed.values.get(name);
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

function printHelp(): void {
  process.stdout.write(`tap-openvsx ${CONVERTER_VERSION}

Usage:
  tap-openvsx inspect <extension.vsix>
  tap-openvsx convert --config <tap.openvsx.json> [--source <extension.vsix>]
  tap-openvsx convert --config <tap.openvsx.json> --skip-adapter
  tap-openvsx verify --config <tap.openvsx.json>

The converter never executes extension code. Final TAP compilation is performed
only by the exact trusted adapter package pinned in the reviewed recipe.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`tap-openvsx: ${message}\n`);
  process.exitCode = 1;
});
