import { expect, it } from "vitest";
import { compareBuildIdentity } from "./build-info";
import type { BuildIdentity } from "../../features/workspaces/model/contracts";

it("rejects same-HEAD dirty deletions even when an older manifest claims inclusion", () => {
  const source: BuildIdentity = {
    schemaVersion: 1,
    buildId: "clean",
    version: "1.2.3",
    channel: "local",
    mode: "debug",
    repositoryId: "repo",
    branch: "main",
    head: "a".repeat(40),
    sourceFingerprint: "clean-source",
    dirtyPaths: [],
    capturedAt: 1,
    components: { web: "clean", native: "clean", host: "clean" },
    includedSources: [],
  };
  const built = {
    ...source,
    sourceFingerprint: "deleted-source",
    dirtyPaths: [{ path: "feature.ts", status: " D" }],
    includedSources: [{ repositoryId: source.repositoryId, sourceHead: source.head }],
  };
  expect(compareBuildIdentity(source, built)).toBe("different");
  expect(compareBuildIdentity(source, source)).toBe("exact");
  expect(compareBuildIdentity(source, { ...built, head: "b".repeat(40) })).toBe("included");
});
