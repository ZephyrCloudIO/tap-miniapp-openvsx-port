import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      id: 'library',
      format: 'esm',
      syntax: 'es2023',
      dts: {
        bundle: true,
      },
      source: {
        entry: {
          index: './src/index.ts',
        },
      },
    },
    {
      id: 'cli',
      format: 'esm',
      syntax: 'es2023',
      dts: false,
      source: {
        entry: {
          cli: './src/cli.ts',
        },
      },
    },
  ],
  output: {
    target: 'node',
    distPath: {
      root: 'dist',
    },
    cleanDistPath: true,
    sourceMap: true,
  },
});
