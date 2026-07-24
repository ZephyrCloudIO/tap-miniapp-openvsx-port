export interface OpenVsxSourceConfig {
  provider: 'openvsx';
  registryUrl: string;
  extensionId: string;
  version: string;
  sha256: string;
}

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

export interface OpenVsxPortConfig {
  schemaVersion: 1;
  converter?: ConverterPin;
  source: OpenVsxSourceConfig;
  conversion: {
    profile: 'static-webview';
    targets: Array<'desktop' | 'mobile'>;
    adapter?: TrustedAdapterConfig;
    webview?: {
      archive?: {
        url: string;
        version: string;
        sha256: string;
      };
      root?: string;
      entry?: string;
      exclude?: string[];
    };
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
