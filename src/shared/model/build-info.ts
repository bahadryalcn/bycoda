import type { BuildIdentity } from "../../features/workspaces/model/contracts";

declare const __BYCODA_BUILD_IDENTITY__: BuildIdentity | null;

/** Stamped at build time. Equal semver and timestamps never establish source inclusion. */
export const buildIdentity: BuildIdentity | null =
  typeof __BYCODA_BUILD_IDENTITY__ === "undefined" ? null : __BYCODA_BUILD_IDENTITY__;

export function buildIdentityLabel(identity: BuildIdentity | null = buildIdentity): string {
  return identity
    ? `${identity.buildId} · ${identity.branch} · ${identity.head.slice(0, 8)}`
    : "source identity unknown";
}

export function compareBuildIdentity(
  source: BuildIdentity | null,
  built: BuildIdentity | null,
): "exact" | "included" | "different" | "unknown" {
  if (!source || !built) return "unknown";
  if (source.repositoryId !== built.repositoryId) return "different";
  if (source.sourceFingerprint === built.sourceFingerprint && source.head === built.head)
    return "exact";
  if (source.head === built.head) return "different";
  if (
    source.dirtyPaths.length === 0 &&
    built.includedSources.some(
      (entry) => entry.repositoryId === source.repositoryId && entry.sourceHead === source.head,
    )
  )
    return "included";
  return "different";
}
