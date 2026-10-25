import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostEngine } from "./engine";
import { HostStore } from "./store";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function store() {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-share-"));
  const path = join(dir, "host.db");
  const opened = new HostStore(path);
  cleanups.push(async () => {
    await opened.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, path, opened };
}

const provider = {
  send: async () => {},
  cancel: async () => {},
  stop: async () => {},
  bind: () => {},
  approve: () => {},
  answer: () => {},
};

it("lists a session started from another computer for this machine's desktop app", async () => {
  const { dir, opened } = store();
  const project = await opened.addProject(dir, "shop");
  const engine = new HostEngine(opened, { claude: provider });
  await engine.ready;
  const { sessionId } = await engine.command({
    type: "create",
    commandId: "create",
    projectId: project.id,
    harness: "claude",
    model: "claude:test",
    runtimeMode: "supervised",
  });
  expect((await opened.session(sessionId)).desktop).toEqual({ updatedAt: 0 });
  expect((await opened.adopted()).map((entry) => entry.id)).toEqual([sessionId]);
  await engine.close();
  await opened.close();
});

it("shares sessions started before this version once the host restarts", async () => {
  const { dir, path, opened } = store();
  const project = await opened.addProject(dir, "shop");
  const engine = new HostEngine(opened, { claude: provider });
  await engine.ready;
  const { sessionId } = await engine.command({
    type: "create",
    commandId: "create",
    projectId: project.id,
    harness: "claude",
    model: "claude:test",
    runtimeMode: "supervised",
  });
  // As an older host wrote it: no desktop marker.
  const { desktop: _shared, ...older } = await opened.session(sessionId);
  await opened.save({ ...older, revision: older.revision + 1 }, { type: "test" });
  expect(await opened.adopted()).toEqual([]);
  await engine.close();
  await opened.close();

  const reopened = new HostStore(path);
  const restarted = new HostEngine(reopened, { claude: provider });
  await restarted.ready;
  expect((await reopened.adopted()).map((entry) => entry.id)).toEqual([sessionId]);
  await restarted.close();
  await reopened.close();
});
