export type DesktopHelperSource = {
  repository: string;
  sourceRef: string;
  version: string;
  protocol: string;
  rustToolchain: string;
  cargoLockSha256: string;
  licenseSha256: string;
  license: string;
};
export const AGENT_DESKTOP_SOURCE: Readonly<DesktopHelperSource>;
export type DesktopHelperFile = { name: string; size: number; sha256: string };
export type DesktopHelperManifest = {
  schema: 1;
  source: DesktopHelperSource;
  platform: string;
  arch: string;
  target: string;
  binary: string;
  toolchain: string;
  compiler: string;
  builtAt: string;
  files: DesktopHelperFile[];
  signing?: {
    kind: "authenticode";
    certificateThumbprint: string;
    unsignedSha256: string;
    signedSha256: string;
    timestamped: true;
    signedAt: string;
  };
};
export type PreparedDesktopHelper = {
  manifestPath: string;
  binaryPath: string;
  binarySha256: string;
  sourceRef: string;
  protocol: string;
  version: string;
  target: string;
  files: DesktopHelperFile[];
  manifest: DesktopHelperManifest;
};
export type DesktopHelperScope = { cacheRoot?: string; platform?: string; arch?: string };
export type DesktopHelperOptions = DesktopHelperScope & {
  signal?: AbortSignal;
  onProgress?: (event: {
    stage: "acquiring" | "building" | "verifying" | "ready";
    workspace: string;
    target: string;
  }) => void;
};
export type DesktopHelperRunner = (
  binary: string,
  args: string[],
  options: {
    cwd?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    env?: Record<string, string | undefined>;
  },
) => Promise<{ stdout: string; stderr?: string; exitCode: number }>;
export function desktopHelperPlan(options?: DesktopHelperScope): Required<DesktopHelperScope> & {
  target: string;
  binary: string;
  helpers: string[];
  bundleDir: string;
  source: DesktopHelperSource;
  files: string[];
  prerequisites: string[];
  configurationChanged: false;
};
export function readDesktopHelper(
  options?: DesktopHelperScope,
): Promise<PreparedDesktopHelper | undefined>;
export function readDesktopHelperBundle(
  bundleDir: string,
  options?: DesktopHelperScope,
): Promise<PreparedDesktopHelper | undefined>;
export function copyDesktopHelperBundle(
  bundleDir: string,
  destination: string,
  options?: DesktopHelperScope,
): Promise<PreparedDesktopHelper>;
export function prepareDesktopHelper(
  options?: DesktopHelperOptions,
  deps?: { run?: DesktopHelperRunner; source?: DesktopHelperSource },
): Promise<PreparedDesktopHelper>;
export function importDesktopHelper(
  options: DesktopHelperOptions & { bundleDir: string },
): Promise<PreparedDesktopHelper>;
export const runHelperProcess: DesktopHelperRunner;
export class DesktopHelperInterruptedError extends Error {
  readonly code: "DESKTOP_HELPER_BUILD_INTERRUPTED";
  readonly childPid: number | undefined;
  constructor(childPid?: number);
}
