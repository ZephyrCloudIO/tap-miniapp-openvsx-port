export {
  extractZip,
  inspectZip,
  readJsonZipEntry,
  readZipEntry,
} from './archive.js';
export { loadPortConfig, type LoadedPortConfig } from './config.js';
export {
  buildBuiltinStaticWebviewMiniapp,
  canUseBuiltinStaticWebviewAdapter,
} from './builtin-adapter.js';
export {
  convertOpenVsxExtension,
  verifyConversionOutputs,
  type ConvertOptions,
} from './convert.js';
export { sha256Bytes, sha256File } from './digest.js';
export { classifyExtension, inspectVsix } from './inspect.js';
export {
  acquireFile,
  extensionDownloadUrl,
  openVsxDownloadUrl,
  visualStudioMarketplaceDownloadUrl,
} from './source.js';
export { CONVERTER_PACKAGE, CONVERTER_VERSION } from './version.js';
export type {
  ConversionResult,
  ConverterPin,
  BridgeBootstrapBinding,
  BridgeMessageBinding,
  BridgeValueTransform,
  ExtensionSourceConfig,
  ExtensionClassification,
  OpenVsxPortConfig,
  OpenVsxSourceConfig,
  PortOutputConfig,
  TrustedAdapterConfig,
  VsCodeCustomEditorBridgeConfig,
  VisualStudioMarketplaceSourceConfig,
  VsixInspection,
} from './types.js';
