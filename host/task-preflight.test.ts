import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkTaskPreflight } from "./task-preflight";
import {
  taskPreflightResourceKey,
  type TaskPreflightRequirement,
} from "../src/features/tasks/model/taskPreflight";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const root = async () => {
  const path = await mkdtemp(join(tmpdir(), "bycoda-preflight-"));
  roots.push(path);
  return path;
};
const source = (id: string): TaskPreflightRequirement => ({ kind: "source", id });

describe("read-only host task preparation", () => {
  it("checks a local source and missing references without returning contents", async () => {
    const cwd = await root();
    await mkdir(join(cwd, "sources"));
    await writeFile(
      join(cwd, "sources", "brief.md"),
      "Private source body, never in preparation output",
    );
    const existing = source("sources/brief.md");
    const missing = source("sources/missing.md");
    const result = await checkTaskPreflight(cwd, [existing, missing], { now: () => 123 });
    expect(result[taskPreflightResourceKey(existing)]).toMatchObject({
      state: "ready",
      checkedAt: 123,
      origin: "runtime",
    });
    expect(result[taskPreflightResourceKey(missing)]?.state).toBe("missing");
    expect(JSON.stringify(result)).not.toContain("Private source body");
  });

  it("refuses project escapes, absolute paths, credentials and symlink directories", async () => {
    const cwd = await root();
    const outside = await root();
    await writeFile(join(outside, "brief.md"), "outside");
    await symlink(outside, join(cwd, "linked"), process.platform === "win32" ? "junction" : "dir");
    const requirements = [
      source("../brief.md"),
      source(join(outside, "brief.md")),
      source(".env"),
      source("linked/brief.md"),
    ];
    const result = await checkTaskPreflight(cwd, requirements);
    expect(Object.values(result).every((value) => value?.state === "disabled")).toBe(true);
  });

  it("keeps external and skill access unknown without a trusted runtime adapter", async () => {
    const cwd = await root();
    const requirements: TaskPreflightRequirement[] = [
      source("https://example.test/document"),
      { kind: "skill", id: "disabled-skill" },
      { kind: "connection", id: "notion" },
      { kind: "tool", id: "browser" },
    ];
    const result = await checkTaskPreflight(cwd, requirements);
    expect(Object.values(result).every((value) => value?.state === "unknown")).toBe(true);
  });

  it("preserves explicit adapter denial and does not invent success after adapter errors", async () => {
    const cwd = await root();
    const requirements: TaskPreflightRequirement[] = [
      { kind: "skill", id: "disabled-skill" },
      { kind: "connection", id: "notion" },
    ];
    const observe = vi.fn(async (requirement: TaskPreflightRequirement) => {
      if (requirement.kind === "skill")
        return { state: "disabled" as const, origin: "configuration" as const, checkedAt: 50 };
      throw new Error("Authentication unavailable");
    });
    const result = await checkTaskPreflight(cwd, requirements, { observe, now: () => 50 });
    expect(result[taskPreflightResourceKey(requirements[0])]?.state).toBe("disabled");
    expect(result[taskPreflightResourceKey(requirements[1])]?.state).toBe("unknown");
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it("does not treat unreadable or removed project folders as empty collections", async () => {
    const cwd = await root();
    const result = await checkTaskPreflight(join(cwd, "missing"), [source("report.md")]);
    expect(result[taskPreflightResourceKey(source("report.md"))]?.state).toBe("unknown");
  });
});
