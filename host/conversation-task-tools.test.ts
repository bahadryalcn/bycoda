import { describe, expect, it } from "vitest";
import type { HostTask } from "../src/features/tasks/model/hostTasks";
import {
  callConversationTaskRead,
  normalizeConversationTaskConfiguration,
} from "./conversation-task-tools";
import { HostStore } from "./store";
import { HostTasks } from "./tasks";

const task = (id: string, patch: Partial<HostTask> = {}): HostTask => ({
  id,
  projectId: "project",
  title: id,
  prompt: "Implement",
  harness: "codex",
  model: "fixture",
  modelSettings: {},
  runtimeMode: "supervised",
  maxRunMinutes: 0,
  status: "todo",
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

describe("conversation task configuration", () => {
  it("normalizes only supported fields and accepts explicit removal", () => {
    const rows = [task("first")];
    expect(
      normalizeConversationTaskConfiguration(
        {
          dependsOn: ["first", "first"],
          verifyCommand: "  pnpm test  ",
          runtimeMode: "auto",
          autoMerge: true,
        },
        "second",
        "project",
        rows,
      ),
    ).toEqual({ dependsOn: ["first"], verifyCommand: "pnpm test" });
    expect(
      normalizeConversationTaskConfiguration(
        { dependsOn: [], verifyCommand: "" },
        "second",
        "project",
        rows,
      ),
    ).toEqual({ dependsOn: [], verifyCommand: "" });
    expect(normalizeConversationTaskConfiguration({}, "second", "project", rows)).toEqual({});
  });

  it("rejects missing, foreign, self, malformed and excessive dependencies", () => {
    const rows = [task("first"), task("foreign", { projectId: "elsewhere" })];
    for (const dependsOn of [
      ["missing"],
      ["foreign"],
      ["second"],
      [123],
      ["invalid/id"],
      Array(21).fill("first"),
      "first",
    ])
      expect(() =>
        normalizeConversationTaskConfiguration({ dependsOn }, "second", "project", rows),
      ).toThrow();
    for (const verifyCommand of [12, "x".repeat(4001), "echo\0secret"])
      expect(() =>
        normalizeConversationTaskConfiguration({ verifyCommand }, "second", "project", rows),
      ).toThrow();
  });

  it("preserves authoritative scheduler cycle detection after normalization", async () => {
    const store = new HostStore(":memory:");
    try {
      const project = await store.addProject("/conversation-task-config", "Fixture");
      const tasks = new HostTasks(store, {} as ConstructorParameters<typeof HostTasks>[1]);
      const first = await tasks.save(task("first", { projectId: project.id }));
      const second = await tasks.save({
        ...task("second", { projectId: project.id }),
        ...normalizeConversationTaskConfiguration(
          { dependsOn: [first.id], verifyCommand: "pnpm test" },
          "second",
          project.id,
          await tasks.list(),
        ),
      });
      expect(second).toMatchObject({ dependsOn: ["first"], verifyCommand: "pnpm test" });
      const patch = normalizeConversationTaskConfiguration(
        { dependsOn: [second.id] },
        first.id,
        project.id,
        await tasks.list(),
      );
      await expect((async () => await tasks.save({ ...first, ...patch }))()).rejects.toThrow(
        "dependency cycle",
      );
      expect((await tasks.get(first.id))?.dependsOn).toBeUndefined();
      const cleared = await tasks.save({
        ...second,
        ...normalizeConversationTaskConfiguration(
          { dependsOn: [], verifyCommand: "" },
          second.id,
          project.id,
          await tasks.list(),
        ),
      });
      expect(cleared.dependsOn).toEqual([]);
      expect(cleared.verifyCommand).toBeUndefined();
    } finally {
      await store.close();
    }
  });
});

describe("conversation task projections", () => {
  it("pages artifact metadata without reading paths or including unrelated hashes", () => {
    const current = task("delivery", {
      artifactPaths: ["temp/a.txt", "temp/b.txt"],
      artifactHashes: { "temp/a.txt": "hash-a", "temp/b.txt": "hash-b", secret: "ignored" },
      deliveredCommit: "commit",
      merged: true,
    });
    expect(callConversationTaskRead("tasks.artifacts.list", { limit: 1 }, current, [])).toEqual({
      taskId: "delivery",
      total: 2,
      offset: 0,
      nextOffset: 1,
      items: [{ path: "temp/a.txt", hash: "hash-a" }],
      deliveredCommit: "commit",
      merged: true,
    });
  });

  it("reports visible dependency blockers and unavailable references without foreign details", () => {
    const current = task("last", { dependsOn: ["first", "done", "foreign", "missing"] });
    const view = callConversationTaskRead("tasks.dependencies.list", {}, current, [
      task("first", { status: "running" }),
      task("done", { status: "done" }),
      task("foreign", { projectId: "other", title: "Private" }),
    ]);
    expect(view).toMatchObject({
      taskId: "last",
      total: 4,
      blockingCount: 1,
      items: [
        { taskId: "first", blocking: true },
        { taskId: "done", blocking: false },
        { taskId: "foreign", status: "unavailable", blocking: false },
        { taskId: "missing", status: "unavailable", blocking: false },
      ],
    });
    expect(JSON.stringify(view)).not.toContain("Private");
    for (const input of [{ offset: -1 }, { limit: 101 }, { limit: "1" }, { offset: 1.5 }])
      expect(() => callConversationTaskRead("tasks.dependencies.list", input, current, [])).toThrow(
        "bounded",
      );
  });
});
