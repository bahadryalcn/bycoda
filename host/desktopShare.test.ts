import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostEngine } from "./engine";
import { HostStore } from "./store";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function store() {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-share-"));
  const path = join(dir, "host.db");
  const opened = new HostStore(path);
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
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

it("lists a session started from another computer for this machine's desktop app", () => {
  const { dir, opened } = store();
  const project = opened.addProject(dir, "shop");
  const engine = new HostEngine(opened, { claude: provider });
  const { sessionId } = engine.command({
    type: "create",
    commandId: "create",
    projectId: project.id,
    harness: "claude",
    model: "claude:test",
    runtimeMode: "supervised",
  });
  expect(opened.session(sessionId).desktop).toEqual({ updatedAt: 0 });
  expect(opened.adopted().map((entry) => entry.id)).toEqual([sessionId]);
  opened.close();
});

it("shares sessions started before this version once the host restarts", () => {
  const { dir, path, opened } = store();
  const project = opened.addProject(dir, "shop");
  const engine = new HostEngine(opened, { claude: provider });
  const { sessionId } = engine.command({
    type: "create",
    commandId: "create",
    projectId: project.id,
    harness: "claude",
    model: "claude:test",
    runtimeMode: "supervised",
  });
  // As an older host wrote it: no desktop marker.
  const { desktop: _shared, ...older } = opened.session(sessionId);
  opened.save({ ...older, revision: older.revision + 1 }, { type: "test" });
  expect(opened.adopted()).toEqual([]);
  opened.close();

  const reopened = new HostStore(path);
  new HostEngine(reopened, { claude: provider });
  expect(reopened.adopted().map((entry) => entry.id)).toEqual([sessionId]);
  reopened.close();
});
