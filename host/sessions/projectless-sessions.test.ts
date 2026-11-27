import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PROJECTLESS_PROJECT_ID } from "../../src/shared/model/host-contracts/projectless-sessions";
import { CommandDispatchParamsSchema } from "../../src/shared/model/host-contracts/session-commands";
import { cleanups, setup } from "../engine-support/engine.test-support";
import { createSessionListRuntime } from "../server/session-list";
import { PROJECTLESS_SCOPE_CWD } from "./projectless-scope";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "bycoda-projectless-home-"));
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("HOME", home);
});

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

const create = (commandId: string, extra: Record<string, unknown> = {}) => ({
  type: "create",
  commandId,
  projectId: PROJECTLESS_PROJECT_ID,
  harness: "codex",
  model: "codex:test",
  runtimeMode: "supervised",
  ...extra,
});

async function listRuntime(store: Awaited<ReturnType<typeof setup>>["store"]) {
  let runtime!: Awaited<ReturnType<typeof createSessionListRuntime>>;
  await createSessionListRuntime(
    {
      engine: { store },
      desktop: {
        listSnapshotAsync: async () => ({ sessions: [], fingerprint: "fixed" }),
        samePath: (x: string, y: string) => x === y,
        pathKey: (path: string) => path,
      },
      desktopWatch: async () => false,
      catchUp: vi.fn(),
      tasks: { changeEtag: async () => "tasks" },
      providers: [],
      pullRequestWatch: { wakeSources: () => new Map() },
    } as never,
    (value) => {
      runtime = value;
    },
  );
  return runtime;
}

it("creates a first turn in a Host-chosen scratch folder and lists it by the reserved scope", async () => {
  const { engine, store, turns, waitForTurnStart } = await setup();
  const command = create("projectless-1", {
    firstTurn: { type: "send", commandId: "projectless-1:first", text: "hello" },
  });

  const receipt = await engine.command(command);
  await waitForTurnStart();
  const saved = await store.session(receipt.sessionId);

  expect(saved.projectId).toBe(PROJECTLESS_PROJECT_ID);
  expect(dirname(saved.session.cwd)).toBe(join(home, ".bycoda-host", "scratch"));
  expect(existsSync(saved.session.cwd)).toBe(true);
  expect(saved.session.worktreeCwd).toBeUndefined();
  expect(turns[0]!.input.cwd).toBe(saved.session.cwd);

  // The same command id replays its receipt instead of creating a second session.
  await expect(engine.command(command)).resolves.toMatchObject({
    sessionId: receipt.sessionId,
  });
  turns[0]!.finish();
  const { list } = await (await listRuntime(store)).projectSessionList(PROJECTLESS_PROJECT_ID);
  expect(list.map((row) => row.id)).toEqual([receipt.sessionId]);
  expect(list[0]!.worktreeCwd).toBeUndefined();
  expect(list[0]!.branch).toBeUndefined();
});

it("gives each session its own folder regardless of a client session id", async () => {
  const { engine, store } = await setup();
  const first = await engine.command(create("projectless-a", { sessionId: "client-chosen" }));
  const second = await engine.command(create("projectless-b"));
  const firstCwd = (await store.session(first.sessionId)).session.cwd;
  const secondCwd = (await store.session(second.sessionId)).session.cwd;

  expect(first.sessionId).toBe("client-chosen");
  expect(firstCwd).not.toContain("client-chosen");
  expect(firstCwd).not.toBe(secondCwd);
});

it.each([
  ["worktree path", { worktreeCwd: "C:/Windows" }],
  ["workspace id", { workspaceId: "workspace-1" }],
  ["worktree mode", { workspaceMode: "worktree" }],
  ["generated branch", { worktreeCwd: "C:/Windows", autoWorktreeBranch: "by/abcd1234" }],
])("refuses a client-supplied %s", async (_name, extra) => {
  const { engine, store } = await setup();
  await expect(engine.command(create("projectless-denied", extra))).rejects.toThrow(
    "Sessions without a project use a Host-managed folder",
  );
  expect(await store.summaries(PROJECTLESS_PROJECT_ID)).toEqual([]);
});

it("keeps the reserved scope out of the project registry and Git lookups", async () => {
  const { engine, store, project } = await setup();
  await engine.command(create("projectless-registry"));

  expect((await store.projects()).map((row) => row.id)).toEqual([project.id]);
  await expect(store.project(PROJECTLESS_PROJECT_ID)).rejects.toThrow(
    "Project is not registered on this machine",
  );
  await expect(store.addProject(PROJECTLESS_SCOPE_CWD, "Escape")).rejects.toThrow(
    "reserved for sessions without a project",
  );
  expect((await store.projects()).map((row) => row.id)).toEqual([project.id]);
});

it("accepts the wire command and runs a follow-up in the same folder", async () => {
  const { engine, store, turns, waitForTurnStart } = await setup();
  const command = create("projectless-follow-up", {
    firstTurn: { type: "send", commandId: "projectless-follow-up:first", text: "first" },
  });
  expect(CommandDispatchParamsSchema.safeParse(command).success).toBe(true);

  const { sessionId } = await engine.command(command);
  await waitForTurnStart();
  const { session } = await store.session(sessionId);
  turns[0]!.finish();
  await vi.waitFor(async () => expect((await store.session(sessionId)).status).toBe("idle"));

  await engine.command({ type: "send", commandId: "projectless-second", sessionId, text: "next" });
  await waitForTurnStart(2);
  expect(turns[1]!.input.cwd).toBe(session.cwd);
  turns[1]!.finish();
  await vi.waitFor(async () => expect((await store.session(sessionId)).status).toBe("idle"));
});

it("keeps ordinary project creation working", async () => {
  const { engine, store, project, directory } = await setup();
  const receipt = await engine.command({
    ...create("project-create"),
    projectId: project.id,
    workspaceMode: "current",
  });
  const saved = await store.session(receipt.sessionId);
  expect(saved.projectId).toBe(project.id);
  expect(saved.session.cwd).toBe(directory);
});
