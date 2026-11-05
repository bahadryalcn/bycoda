import { afterEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { HostEngine } from "../../engine";
import { writerWorkspaces } from "../../workspaces/writer-workspaces.test-support";
import { executeRoomSessionAction, validateRoomSessionAction } from "./assistant-room-session";
import type { SendTurnInput } from "../../../src/integrations/harness/core/types";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "room-host-session-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: directory, windowsHide: true, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.test");
  writeFileSync(join(directory, "file.txt"), "Fixture\n");
  git("add", "file.txt");
  git("commit", "-q", "-m", "Fixture");
  const store = new HostStore(join(directory, "host.db"));
  const project = await store.addProject(directory, "Fixture");
  const started = Promise.withResolvers<SendTurnInput>(),
    finished = Promise.withResolvers<void>();
  const provider = {
    send: vi.fn(async (input: SendTurnInput) => {
      started.resolve(input);
      await finished.promise;
    }),
    cancel: vi.fn(async () => {
      finished.resolve();
    }),
    stop: vi.fn(async () => {
      finished.resolve();
    }),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const engine = new HostEngine(store, { codex: provider });
  vi.spyOn(engine.checkpoints, "begin").mockResolvedValue();
  vi.spyOn(engine.checkpoints, "finish").mockResolvedValue();
  await writerWorkspaces(directory, async (id) => (await store.project(id)).cwd).attachEngine(
    engine,
  );
  const source = {
    kind: "assistant-thread" as const,
    threadId: "real-room",
    projectId: project.id,
    name: "Assistant",
  };
  let allowed = true;
  const call = (
    action: Parameters<typeof executeRoomSessionAction>[0],
    input: Record<string, unknown>,
  ) => executeRoomSessionAction(action, input, source, async () => allowed, store, engine);
  cleanups.push(async () => {
    finished.resolve();
    await engine.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  return {
    store,
    engine,
    source,
    provider,
    started,
    finished,
    call,
    revoke: () => {
      allowed = false;
    },
  };
}
const create = {
  requestId: "create",
  harness: "codex",
  model: "codex:fixture",
  modelSettings: {},
  runtimeMode: "supervised",
};
it("keeps an accepted Host run independent from the released Room request permit", async () => {
  const f = await fixture();
  const created = await f.call("sessions.create", create);
  const session = await f.store.session(created.sessionId);
  const providerGate = Promise.withResolvers<void>();
  f.engine.beforeProviderTurn = async () => { await providerGate.promise; };
  let permit = true;
  const receipt = await f.store.db.withAuthorization(async () => permit, () => f.call("sessions.submit", {
    requestId: "delayed-provider", sessionId: created.sessionId, expectedRevision: session.revision, text: "Accepted background work",
  }));
  permit = false;
  providerGate.resolve();
  const input = await f.started.promise;
  input.onEvent({ type: "message.delta", text: "Finished after Room permit ended." });
  input.onEvent({ type: "message.completed" });
  f.finished.resolve();
  await f.engine.waitForRun(created.sessionId, receipt.runId);
  const settled = await f.store.session(created.sessionId);
  expect(settled.status).toBe("idle");
  expect(settled.session.blocks.some(block => block.text === "Finished after Room permit ended.")).toBe(true);
});
it("creates unsent Host sessions and transfers one reviewed submit to the exact canonical run", async () => {
  const f = await fixture();
  const created = await f.call("sessions.create", create);
  expect(f.provider.send).not.toHaveBeenCalled();
  const session = await f.store.session(created.sessionId);
  expect(session.session.blocks).toEqual([]);
  const result = await f.call("sessions.submit", {
    requestId: "submit",
    sessionId: created.sessionId,
    expectedRevision: session.revision,
    text: "Explicit work",
  });
  expect(result).toMatchObject({ state: "accepted", sessionId: created.sessionId });
  const input = await f.started.promise;
  expect(input.text).toContain("Explicit work");
  expect(f.provider.send).toHaveBeenCalledOnce();
  const saved = await f.store.session(created.sessionId);
  expect(saved.session.blocks.find((block) => block.role === "user")?.author).toMatchObject({
    kind: "assistant-room",
    threadId: "real-room",
    operationId: "submit",
  });
  expect(
    await f.call("sessions.submit.status", {
      sessionId: created.sessionId,
      submissionId: "submit",
    }),
  ).toMatchObject({ state: "accepted", runId: result.runId });
  expect(
    await f.call("sessions.submit.status", {
      sessionId: created.sessionId,
      submissionId: "unknown",
    }),
  ).toMatchObject({ state: "unknown" });
  await expect(
    f.call("sessions.stop", {
      requestId: "wrong-stop",
      sessionId: created.sessionId,
      runId: "different",
    }),
  ).rejects.toThrow("run changed");
  await f.call("sessions.stop", {
    requestId: "stop",
    sessionId: created.sessionId,
    runId: saved.runId,
  });
  await vi.waitFor(() => expect(f.provider.cancel).toHaveBeenCalledOnce());
  expect(
    await f.call("sessions.submit.status", { sessionId: created.sessionId, submissionId: "stop" }),
  ).toMatchObject({ state: "unknown" });
  expect(
    await f.call("sessions.submit.status", {
      sessionId: created.sessionId,
      submissionId: "create",
    }),
  ).toMatchObject({ state: "unknown" });
});
it("rejects changed revisions, drafts, native ownership and revoked Room authority before submit", async () => {
  const f = await fixture();
  const created = await f.call("sessions.create", create);
  const session = await f.store.session(created.sessionId);
  const submit = {
    requestId: "submit",
    sessionId: created.sessionId,
    expectedRevision: session.revision + 1,
    text: "Explicit work",
  };
  await expect(f.call("sessions.submit", submit)).rejects.toThrow("conversation changed");
  await f.engine.command({
    type: "draft",
    commandId: "owner-draft",
    sessionId: created.sessionId,
    text: "Owner draft",
  });
  const drafted = await f.store.session(created.sessionId);
  await expect(
    f.call("sessions.submit", { ...submit, expectedRevision: drafted.revision }),
  ).rejects.toThrow("unsent draft");
  await f.store.save(
    { ...drafted, revision: drafted.revision + 1, executionOwner: "desktop" },
    "session.updated",
  );
  await expect(
    f.call("sessions.submit", { ...submit, expectedRevision: drafted.revision }),
  ).rejects.toThrow("native desktop owner");
  f.revoke();
  await expect(f.call("sessions.create", { ...create, requestId: "revoked" })).rejects.toThrow(
    "authority revoked",
  );
  expect(f.provider.send).not.toHaveBeenCalled();
});
it("retains strict request identity and forbids hidden first turns or forged author fields", () => {
  expect(() =>
    validateRoomSessionAction(
      "sessions.create",
      { ...create, firstTurn: { text: "Hidden send" } },
      "create",
    ),
  ).toThrow();
  expect(() =>
    validateRoomSessionAction(
      "sessions.submit",
      {
        requestId: "x",
        sessionId: "s",
        expectedRevision: 0,
        text: "work",
        author: { kind: "owner" },
      },
      "x",
    ),
  ).toThrow();
  expect(() => validateRoomSessionAction("sessions.create", create, "different")).toThrow(
    "identity changed",
  );
});
