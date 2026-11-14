export type CuaDriverSource = {
  repository: string;
  releaseTag: string;
  version: string;
  license: string;
  licenseSha256: string;
};
export const CUA_DRIVER_SOURCE: Readonly<CuaDriverSource>;
export const CUA_DRIVER_FILES: readonly string[];
export type CuaDriverFile = { name: string; size: number; sha256: string };
export type CuaDriverManifest = {
  schema: 1;
  driver: "cua-driver";
  version: string;
  releaseTag: string;
  target: string;
  archive: string;
  archiveSha256: string;
  installedAt: string;
  files: CuaDriverFile[];
};
export type PreparedCuaDriver = {
  manifestPath: string;
  binaryPath: string;
  binarySha256: string;
  sourceRef: string;
  protocol: string;
  version: string;
  target: string;
  files: CuaDriverFile[];
  manifest: CuaDriverManifest;
};
export type CuaDriverScope = { cacheRoot?: string; platform?: string; arch?: string };
export type CuaDriverOptions = CuaDriverScope & {
  signal?: AbortSignal;
  onProgress?: (event: {
    stage: "acquiring" | "verifying" | "ready";
    workspace: string;
    target: string;
  }) => void;
};
export function cuaDriverPlan(options?: CuaDriverScope): {
  platform: string;
  arch: string;
  target: string;
  asset: string;
  sha256: string;
  folder: string;
  cacheRoot: string;
  bundleDir: string;
  source: CuaDriverSource;
  url: string;
  files: string[];
  configurationChanged: false;
};
export function readCuaDriver(options?: CuaDriverScope): Promise<PreparedCuaDriver | undefined>;
export function readCuaDriverBundle(
  bundleDir: string,
  options?: CuaDriverScope,
): Promise<PreparedCuaDriver | undefined>;
export function copyCuaDriverBundle(
  bundleDir: string,
  destination: string,
  options?: CuaDriverScope,
): Promise<PreparedCuaDriver>;
export function prepareCuaDriver(
  options?: CuaDriverOptions,
  deps?: {
    download?: (url: string, path: string, sha256: string, signal: AbortSignal) => Promise<void>;
    extract?: (archive: string, directory: string, signal: AbortSignal) => Promise<void>;
  },
): Promise<PreparedCuaDriver>;
