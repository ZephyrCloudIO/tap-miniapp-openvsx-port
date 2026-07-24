export interface OpenVsxSourceConfig {
  provider: 'openvsx';
  registryUrl: string;
  extensionId: string;
  version: string;
  sha256: string;
}

export interface VisualStudioMarketplaceSourceConfig {
  provider: 'visualstudio-marketplace';
  registryUrl: 'https://marketplace.visualstudio.com';
  extensionId: string;
  version: string;
  sha256: string;
}

export type ExtensionSourceConfig =
  | OpenVsxSourceConfig
  | VisualStudioMarketplaceSourceConfig;

export interface ConverterPin {
  repository: string;
  package: '@theaiplatform/openvsx-port';
  version: string;
  binary: 'tap-openvsx';
  registry?: 'https://registry.npmjs.org';
  access?: 'public';
  packagePage?: string;
}

export interface TrustedAdapterConfig {
  package: string;
  version: string;
  binary: string;
  args: string[];
}

export interface PortOutputConfig {
  workingDirectory: string;
  npmTarball: string;
  compatibilityReport: string;
  attestation: string;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type BridgeValueTransform =
  | 'identity'
  | 'byte-array-to-base64'
  | 'base64-to-byte-array';

export interface BridgeMessageBinding {
  messageType: string;
  messageValuePath: string[];
  statePath: string[];
  transform?: Exclude<BridgeValueTransform, 'base64-to-byte-array'>;
}

export interface BridgeBootstrapBinding {
  statePath: string[];
  bootstrapPath: string[];
  transform?: Exclude<BridgeValueTransform, 'byte-array-to-base64'>;
}

export interface VsCodeCustomEditorBridgeConfig {
  kind: 'vscode-custom-editor';
  viewType: string;
  bootstrap: {
    selector: string;
    attribute: string;
    encoding: 'base64-json';
    value?: JsonValue;
  };
  storage?: {
    namespace: string;
    key: string;
    initialValue: JsonValue;
    messageTypePath?: string[];
    messageBindings: BridgeMessageBinding[];
    bootstrapBindings: BridgeBootstrapBinding[];
    vscodeStatePath?: string[];
  };
  session?: {
    namespace: string;
  };
  webviewToHostMessages?: string[];
  hostToWebviewMessages?: string[];
  requiredHostOperations?: string[];
}

export interface OpenVsxPortConfig {
  schemaVersion: 1;
  converter?: ConverterPin;
  source: ExtensionSourceConfig;
  conversion: {
    profile: 'static-webview';
    targets: Array<'desktop' | 'mobile'>;
    adapter?: TrustedAdapterConfig;
    webview?: {
      source?: 'extension';
      archive?: {
        url: string;
        version: string;
        sha256: string;
      };
      assets?: Array<{
        url: string;
        sha256: string;
        path: string;
      }>;
      root?: string;
      entry?: string;
      exclude?: string[];
      rebaseRootPaths?: string[];
      replacements?: Array<{
        search: string;
        replace: string;
        files?: string[];
      }>;
    };
    bridge?: VsCodeCustomEditorBridgeConfig;
    [key: string]: unknown;
  };
  tap: Record<string, unknown>;
  npm: {
    name: string;
    version: string;
    access: 'public';
    registry: 'https://registry.npmjs.org';
    [key: string]: unknown;
  };
  output: PortOutputConfig;
}

export type ExtensionClassification =
  | 'static-webview'
  | 'browser-extension-host'
  | 'node-extension-host'
  | 'declarative-only';

export interface VsixInspection {
  archiveSha256: string;
  archiveBytes: number;
  entryCount: number;
  totalUncompressedBytes: number;
  extension: {
    id: string;
    publisher: string;
    name: string;
    version: string;
    displayName: string | null;
    main: string | null;
    browser: string | null;
    activationEvents: string[];
    extensionDependencies: string[];
    extensionPack: string[];
    customEditors: Array<{
      viewType: string;
      displayName: string;
      priority: string | null;
      filenamePatterns: string[];
    }>;
    commands: string[];
    configurationKeys: string[];
  };
  classification: ExtensionClassification;
  findings: string[];
}

export interface ConversionResult {
  tarballPath: string;
  compatibilityReportPath: string;
  attestationPath: string;
  inspection: VsixInspection;
}
