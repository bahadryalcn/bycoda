import { afterEach, describe, expect, it } from "vitest";
import { additionalDirsFor, setAdditionalDirsResolver } from "./additionalDirs";
import { buildClaudeSpawnArgs } from "../providers/claude/claudeProtocol";
import { buildThreadStartParams, buildTurnStartParams } from "../providers/codex/codexProtocol";

afterEach(() => setAdditionalDirsResolver(() => []));

describe("additionalDirsFor", () => {
  it("is empty until the app registers a resolver", () => {
    expect(additionalDirsFor("s1")).toEqual([]);
  });

  it("asks the resolver and survives it throwing", () => {
    setAdditionalDirsResolver((id) => (id === "s1" ? ["/work/api"] : []));
    expect(additionalDirsFor("s1")).toEqual(["/work/api"]);
    expect(additionalDirsFor("s2")).toEqual([]);

    setAdditionalDirsResolver(() => {
      throw new Error("boom");
    });
    expect(additionalDirsFor("s1")).toEqual([]);
  });
});

describe("Claude spawn args", () => {
  it("passes one --add-dir per folder", () => {
    const args = buildClaudeSpawnArgs({
      additionalDirs: ["/work/api", "/work/ui"],
      resume: "sess-1",
    });
    const first = args.indexOf("--add-dir");
    expect(args.slice(first, first + 5)).toEqual([
      "--add-dir",
      "/work/api",
      "--add-dir",
      "/work/ui",
      "--resume",
    ]);
  });

  it("omits the flag without folders", () => {
    expect(buildClaudeSpawnArgs({})).not.toContain("--add-dir");
    expect(buildClaudeSpawnArgs({ additionalDirs: [] })).not.toContain("--add-dir");
  });
});

describe("Codex sandbox policy", () => {
  const dirs = ["/work/api"];

  it("adds writable roots to a workspace-write thread and turn", () => {
    expect(
      buildThreadStartParams({ cwd: "/work/web", runtimeMode: "auto", additionalDirs: dirs })
        .sandboxPolicy,
    ).toEqual({ type: "workspaceWrite", writableRoots: dirs });
    expect(
      buildTurnStartParams({ threadId: "t", runtimeMode: "auto", additionalDirs: dirs })
        .sandboxPolicy,
    ).toEqual({ type: "workspaceWrite", writableRoots: dirs });
  });

  it("leaves read-only, plan, and full-access policies alone", () => {
    expect(
      buildThreadStartParams({
        cwd: "/work/web",
        runtimeMode: "supervised",
        additionalDirs: dirs,
      }).sandboxPolicy,
    ).toEqual({ type: "readOnly" });
    expect(
      buildTurnStartParams({
        threadId: "t",
        runtimeMode: "auto",
        intent: "plan",
        additionalDirs: dirs,
      }).sandboxPolicy,
    ).toEqual({ type: "readOnly" });
    expect(
      buildTurnStartParams({
        threadId: "t",
        runtimeMode: "full-access",
        additionalDirs: dirs,
      }).sandboxPolicy,
    ).toEqual({ type: "dangerFullAccess" });
  });

  it("adds nothing without folders", () => {
    expect(buildTurnStartParams({ threadId: "t", runtimeMode: "auto" }).sandboxPolicy).toEqual({
      type: "workspaceWrite",
    });
  });
});
