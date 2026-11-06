import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { REMOTE_PROVIDERS } from "../../src/features/connections/model/protocol";
import { HostEngine } from "../engine";
import type { HostProvider } from "../providers/providers";
import { confirmedRunProgress, finishedRunProgress } from "./run-duration";
import { HostStore } from "../store";

it("admits the exact new run before dispatch and preserves its identity on receipt replay", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-run-duration-"));
  const store = new HostStore(join(directory, "host.db"));
  const provider: HostProvider = {
    send: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const engine = new HostEngine(
    store,
    Object.fromEntries(REMOTE_PROVIDERS.map((id) => [id, provider])),
  );
  try {
    const project = await store.addProject(directory, "Test");
    await engine.ready;
    const created = await engine.command({
      type: "create",
      commandId: "create",
      projectId: project.id,
      workspaceMode: "current",
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const command = {
      type: "send" as const,
      commandId: "send",
      sessionId: created.sessionId,
      text: "Test",
    };
    const receipt = await engine.command(command);
    expect(receipt.runId).toBeTruthy();
    const checkpoint = await store.db
      .prepare(
        "SELECT elapsed, uncertain FROM run_duration_checkpoints WHERE session_id=? AND run_id=?",
      )
      .get(created.sessionId, receipt.runId);
    expect(checkpoint).toMatchObject({ elapsed: 0, uncertain: 0 });
    expect(
      (await confirmedRunProgress(store, created.sessionId, receipt.runId!, Date.now())).uncertain,
    ).toBe(false);
    expect((await engine.command(command)).runId).toBe(receipt.runId);
    await engine.waitForRun(created.sessionId, receipt.runId);
    expect(await finishedRunProgress(store, created.sessionId, receipt.runId!)).toMatchObject({
      uncertain: false,
    });
  } finally {
    await engine.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("does not publish a finish checkpoint if the settled session save fails", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-run-save-failure-"));
  const store = new HostStore(join(directory, "host.db"));
  const provider: HostProvider = {
    send: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const engine = new HostEngine(
    store,
    Object.fromEntries(REMOTE_PROVIDERS.map((id) => [id, provider])),
  );
  const save = store.save.bind(store);
  let refused = false;
  vi.spyOn(store, "save").mockImplementation(async (input, event, options) => {
    if ((event as { type?: string })?.type === "settled") {
      refused = true;
      throw new Error("injected settled save failure");
    }
    return await save(input, event, options);
  });
  try {
    const project = await store.addProject(directory, "Test");
    await engine.ready;
    const created = await engine.command({
      type: "create",
      commandId: "create",
      projectId: project.id,
      workspaceMode: "current",
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const receipt = await engine.command({
      type: "send",
      commandId: "send",
      sessionId: created.sessionId,
      text: "Test",
    });
    // The run settles asynchronously after dispatch; slow Windows runners need
    // more than vi.waitFor's default one second to reach the settled save.
    await vi.waitFor(() => expect(refused).toBe(true), { timeout: 20_000, interval: 50 });
    expect(await finishedRunProgress(store, created.sessionId, receipt.runId!)).toBeNull();
  } finally {
    await engine.close().catch(() => {}); // The injected persistence failure is retained in cleanup.
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);
