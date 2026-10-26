import type { BuildIdentity } from "../../host/workspace-contracts";
export function parseBuildIdentity(value: unknown): BuildIdentity | null;
export function readBuildIdentity(path: string): Promise<BuildIdentity | null>;
export function sourceFiles(
  root: string,
  options?: { signal?: AbortSignal },
): Promise<Map<string, Buffer>>;
export function fingerprintFiles(files: Map<string, Buffer>): string;
export function sourceIdentity(
  root: string,
  options?: { signal?: AbortSignal },
): Promise<
  Pick<BuildIdentity, "repositoryId" | "branch" | "head" | "sourceFingerprint" | "dirtyPaths">
>;
export function captureBuildIdentity(request: {
  sourceRoot: string;
  frozenRoot: string;
  buildId: string;
  version: string;
  channel: string;
  mode: string;
}): Promise<BuildIdentity>;
