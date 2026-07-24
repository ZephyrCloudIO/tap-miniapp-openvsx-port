import { expect, it } from '@rstest/core';
import packageMetadata from '../package.json' with { type: 'json' };
import { CONVERTER_VERSION } from './version.js';

it('uses the package version as the converter runtime version', () => {
  expect(CONVERTER_VERSION).toBe(packageMetadata.version);
});
