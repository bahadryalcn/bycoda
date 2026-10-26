import { expect, it } from "vitest";
import {
  managedWorkspaceBuffers,
  createWorkspaceBufferReporter,
} from "./useManagedWorkspaceBuffers";
import type { FilePaneTab } from "../../../features/workspace/model/layout";

it("reports all local editor paths and retains dirty state across duplicate panes", () => {
  const files: FilePaneTab[] = [
    { id: "clean", path: "/owned/a.ts", cwd: "/owned" },
    { id: "dirty", path: "/owned/a.ts", cwd: "/owned" },
    { id: "other", path: "/owned/b.ts", cwd: "/owned" },
    { id: "terminal", path: "/owned", cwd: "/owned", terminal: true },
    { id: "remote", path: "remote://env/owned/c.ts", cwd: "remote://env/owned" },
    {
      id: "virtual",
      path: "/owned/plan.md",
      cwd: "/owned",
      releaseNotes: { version: "1" } as FilePaneTab["releaseNotes"],
    },
  ];
  expect(managedWorkspaceBuffers(files, new Set(["dirty", "terminal", "virtual"]))).toEqual([
    { path: "/owned/a.ts", dirty: true },
    { path: "/owned/b.ts", dirty: false },
  ]);
  expect(managedWorkspaceBuffers([], new Set(["dirty"]))).toEqual([]);
});

it("waits for each native snapshot and continues after an unknown report without clearing it", async () => {
  const seen: string[][] = [];
  let release!: () => void;
  const report = createWorkspaceBufferReporter(async (buffers) => {
    seen.push(buffers.map((buffer) => `${buffer.path}:${buffer.dirty}`));
    if (seen.length === 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    if (seen.length === 2) throw new Error("Host unavailable");
  });
  const first = report([{ path: "/owned/a.ts", dirty: false }]);
  const second = report([{ path: "/owned/a.ts", dirty: true }]);
  const third = report([]);
  await Promise.resolve();
  expect(seen).toEqual([["/owned/a.ts:false"]]);
  release();
  await first;
  await expect(second).rejects.toThrow("Host unavailable");
  await third;
  expect(seen).toEqual([["/owned/a.ts:false"], ["/owned/a.ts:true"], []]);
});
