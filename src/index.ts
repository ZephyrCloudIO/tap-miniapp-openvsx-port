export {
  extractZip,
  inspectZip,
  readJsonZipEntry,
  readZipEntry,
} from './archive.js';
export { loadPortConfig, type LoadedPortConfig } from './config.js';
export {
  convertOpenVsxExtension,
  verifyConversionOutputs,
  type ConvertOptions,
} from './convert.js';
export { sha256Bytes, sha256File } from './digest.js';
export { classifyExtension, inspectVsix } from './inspect.js';
export { acquireFile, openVsxDownloadUrl } from './source.js';
export { CONVERTER_PACKAGE, CONVERTER_VERSION } from './version.js';
export type {
  ConversionResult,
  ConverterPin,
  ExtensionClassification,
  OpenVsxPortConfig,
  OpenVsxSourceConfig,
  PortOutputConfig,
  TrustedAdapterConfig,
  VsixInspection,
} from './types.js';
