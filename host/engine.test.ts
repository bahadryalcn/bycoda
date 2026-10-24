import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import type { HostProvider } from "./providers";
import { HostEngine, parseCommand } from "./engine";
import { HostStore } from "./store";
import { readAttachmentChunk, writeAttachmentChunk } from "./attachments";
import {
  applySessionSync,
  REMOTE_PROVIDERS,
  type RemoteProvider,
} from "../src/features/connections/model/protocol";
import { sessionIssue } from "../src/features/sessions/model/sessionIssue";
import { isActivityBlock, isNoticeBlock } from "../src/features/sessions/model/transcriptActivity";
import { conversationHead } from "../src/features/sync/model/conversationDigest";

const cleanups: Array<() => Promise<void> | void> = [];

it("validates and persists the explicitly selected profile before sending a new host session", async () => {
  const { engine, store, project, turns } = setup();
  const command = { type: "create", commandId: "named-profile", projectId: project.id, harness: "codex", model: "codex:test", runtimeMode: "supervised", providerAccountId: "account-work" };
  const created = engine.command(command);
  expect(store.session(created.sessionId).session.providerAccountId).toBe("account-work");
  engine.command({ type: "send", commandId: "send-named", sessionId: created.sessionId, text: "hello" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  expect(turns[0].input.providerAccountId).toBe("account-work");
  expect(() => parseCommand({ ...command, providerAccountId: "../outside" })).toThrow("Invalid provider account ID");
});

it("sends the reviewed note snapshot once while persisting display metadata without its body", async () => {
  const { engine, store, id, turns, provider } = setup();
  const noteCard = { id: "note-a", slug: "review", title: "Review", body: "Reviewed note body", sourceCwd: "/source" };
  const command = { type: "send", commandId: "note-context", sessionId: id, text: "Check this", noteCard };
  expect(provider.send).not.toHaveBeenCalled();
  const receipt = engine.command(command);
  expect(engine.command(command)).toEqual(receipt);
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  expect(turns[0].input.text).toContain('Referenced note "Review":\n\nReviewed note body');
  const user = store.session(id).session.blocks.find((block) => block.id === command.commandId)!;
  expect(user.text).toBe("Check this");
  expect(user.noteCard).toEqual({ id: "note-a", slug: "review", title: "Review", sourceCwd: "/source" });
  expect(JSON.stringify(user)).not.toContain("Reviewed note body");
  expect(() => engine.command({ ...command, noteCard: { ...noteCard, body: "Changed snapshot" } })).toThrow();
  turns[0].finish();
  await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
  engine.command({ ...command, commandId: "note-only", text: "" });
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  expect(turns[1].input.text).toContain("Use this note.");
  turns[1].finish();
});

it("rejects unsupported note context actions before changing the conversation", () => {
  const { engine, store, id, provider } = setup();
  const noteCard = { id: "note-a", slug: "review", title: "Review", body: "Reviewed note body" };
  const original = store.session(id);
  const base = { type: "send", commandId: "invalid-note", sessionId: id, text: "Check", noteCard };
  for (const extra of [{ type: "steer" }, { type: "draft" }, { type: "compact" }, { intent: "plan" }, { text: "/clear" }, { text: "/compact" }, { queued: {} }, { noteCard: { ...noteCard, body: "x".repeat(64_001) } }])
    expect(() => engine.command({ ...base, ...extra })).toThrow();
  expect(store.session(id)).toEqual(original);
  expect(provider.send).not.toHaveBeenCalled();
});

it("keeps a Codex goal command leading while carrying reviewed note content in runtime instructions", async () => {
  const { engine, store, id, turns } = setup();
  engine.command({ type: "send", commandId: "goal-note-context", sessionId: id, text: "/goal Review the changes", noteCard: { id: "note-goal", slug: "goal", title: "Review goals", body: "Check keyboard and focus." } });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  expect(turns[0].input.text).toBe("/goal Review the changes");
  expect(turns[0].input.runtimeInstructions).toContain("Check keyboard and focus.");
  expect(store.session(id).session.blocks.find((block) => block.id === "goal-note-context")?.noteCard?.title).toBe("Review goals");
  turns[0].finish();
});

it("keeps browser annotation attachments bound to their exact project and conversation", async () => {
  const { engine, store, id, project, turns, provider } = setup();
  const fileId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  await writeAttachmentChunk(store, { id: fileId, offset: 0, size: 3, data: Buffer.from("abc").toString("base64") });
  const annotation = { id: "selection", projectId: project.id, sessionId: id, navigationId: "reviewed-navigation", capturedAt: "2026-10-22T00:00:00.000Z", pageUrl: "https://fixture.invalid", trust: "untrusted-page-data", limitations: [], comment: "Check this element",
    viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 }, devicePixelRatio: 1,
    element: { tag: "button", text: "Page content", selector: "#fixture", path: "body > button", bounds: { x: 1, y: 2, width: 20, height: 30 }, center: { x: 11, y: 17 }, ancestry: [], computedStyle: {} } };
  const file = { id: fileId, name: "browser-element.jpg", size: 3, mimeType: "image/jpeg", kind: "image", browserAnnotation: annotation };
  const base = { type: "send", commandId: "browser-selection", sessionId: id, text: "Review the selected element" };
  const original = store.session(id);
  for (const patch of [{ projectId: "foreign-project" }, { sessionId: "foreign-session" }])
    expect(() => engine.command({ ...base, attachments: [{ ...file, browserAnnotation: { ...annotation, ...patch } }] })).toThrow(/another project or conversation/);
  for (const type of ["draft", "steer"])
    expect(() => engine.command({ ...base, type, runId: "not-running", attachments: [{ ...file, browserAnnotation: { ...annotation, sessionId: "foreign-session" } }] })).toThrow(/another project or conversation/);
  expect(store.session(id)).toEqual(original); expect(provider.send).not.toHaveBeenCalled();
  engine.command({ ...base, attachments: [file] });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  expect(turns[0].input.attachments?.[0]?.browserAnnotation).toMatchObject({ sessionId: id, projectId: project.id, trust: "untrusted-page-data", comment: "Check this element" });
  turns[0].finish();
});

it("clears the same host session durably and starts the next turn without the old binding", async () => {
  const { engine, store, id, provider, turns } = setup();
  engine.command({ type: "send", commandId: "before-clear", sessionId: id, text: "Old context" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  turns[0].input.onEvent({ type: "session.providerBound", providerSessionId: "old-native" });
  turns[0].finish();
  await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
  vi.mocked(provider.stop).mockClear();
  vi.mocked(provider.bind).mockClear();
  const command = { type: "send", commandId: "clear", sessionId: id, text: "/clear" };
  const receipt = await engine.clearConversation(command);
  expect(await engine.clearConversation(command)).toEqual(receipt);
  expect(provider.stop).toHaveBeenCalledOnce();
  expect(store.session(id).session).toMatchObject({ id, blocks: [] });
  expect(store.session(id).session.providerSessionId).toBeUndefined();
  expect(store.session(id).session.pendingContextReplay).toBeUndefined();
  expect(provider.send).toHaveBeenCalledOnce();
  engine.command({ type: "send", commandId: "after-clear", sessionId: id, text: "New context" });
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  expect(turns[1].input.text).toBe("New context");
  expect(provider.bind).not.toHaveBeenCalled();
});

it("rejects clearing a running host session", async () => {
  const { engine, id, provider, turns } = setup();
  engine.command({ type: "send", commandId: "running", sessionId: id, text: "Keep working" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  await expect(engine.clearConversation({ type: "send", commandId: "clear-busy", sessionId: id, text: "/clear" })).rejects.toThrow("Stop the current turn");
  expect(provider.stop).not.toHaveBeenCalled();
});

it("surfaces provider startup rejection as a failed turn outside folded activity", async () => {
  const { engine, store, id, provider } = setup();
  provider.send = vi.fn(async () => {
    throw new Error("thread test already has an active writer");
  });
  engine.command({ type: "send", commandId: "writer-conflict", sessionId: id, text: "Continue" });
  await vi.waitFor(() => expect(store.session(id).session.blocks.at(-1)?.notice).toBe("error"));
  const session = store.session(id).session;
  expect(sessionIssue(session)).toBe("failed");
  expect(isNoticeBlock(session.blocks.at(-1)!)).toBe(true);
  expect(isActivityBlock(session.blocks.at(-1)!)).toBe(false);
  expect(session.blocks.at(-1)?.text).toContain("active writer");
});

it("tells who is waiting on a turn how it ended, and why a conversation cannot start one", async () => {
  const { engine, store, id, provider, turns } = setup();
  const ended: Array<{ cancelled?: boolean; error?: string; interrupted?: boolean }> = [];
  engine.onSettled = (_id, outcome) => void ended.push(outcome);
  expect(engine.busyReason(id)).toBeUndefined();
  // A turn that ends well.
  engine.command({ type: "send", commandId: "ok-1", sessionId: id, text: "one" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  turns[0].finish();
  await vi.waitFor(() => expect(ended).toHaveLength(1));
  expect(ended[0]).toEqual({});
  // A turn the user stopped is not a failure, whatever the provider says.
  engine.command({ type: "send", commandId: "ok-2", sessionId: id, text: "two" });
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  engine.command({ type: "cancel", commandId: "stop-2", sessionId: id, runId: store.session(id).runId! });
  await vi.waitFor(() => expect(ended).toHaveLength(2));
  expect(ended[1]).toEqual({ cancelled: true });
  // A provider that fails carries its message.
  provider.send = vi.fn(async () => {
    throw new Error("provider exploded");
  });
  engine.command({ type: "send", commandId: "ok-3", sessionId: id, text: "three" });
  await vi.waitFor(() => expect(ended).toHaveLength(3));
  expect(ended[2]).toEqual({ error: "provider exploded" });
  // The host going down is told apart too.
  const stopping = engine.close();
  expect(engine.busyReason(id)).toBe("Host is stopping");
  await stopping;
});

it("attributes only successful edit tool paths to the active checkpoint turn", async () => {
  const { engine, store, id, turns } = setup();
  const claim = vi.spyOn(engine.checkpoints, "claim").mockResolvedValue(undefined);
  engine.command({
    type: "send",
    commandId: "checkpoint-tools",
    sessionId: id,
    text: "Edit files",
  });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  turns[0].input.onEvent({
    type: "tool.updated",
    id: "read",
    kind: "read",
    status: "completed",
    paths: ["foreign.txt"],
  });
  turns[0].input.onEvent({
    type: "tool.updated",
    id: "failed",
    kind: "write",
    status: "failed",
    paths: ["failed.txt"],
  });
  expect(claim).not.toHaveBeenCalled();
  turns[0].input.onEvent({
    type: "tool.updated",
    id: "write",
    kind: "write",
    status: "completed",
    paths: ["new.txt"],
  });
  expect(claim).toHaveBeenCalledWith(id, store.session(id).session.cwd, store.session(id).runId, [
    "new.txt",
  ]);
  turns[0].finish();
  await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
});

it("steers the active host turn without replacing it, and deduplicates retries", async () => {
  const { engine, store, id, provider, turns } = setup();
  provider.steer = vi.fn(async () => {});
  engine.command({ type: "send", commandId: "start", sessionId: id, text: "first" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  const runId = store.session(id).runId!;
  turns[0].input.onAccepted?.();
  const command = { type: "steer", commandId: "redirect", sessionId: id, runId, text: "second" };
  const receipt = engine.command(command);
  expect(engine.command(command)).toEqual(receipt);
  await vi.waitFor(() => expect(provider.steer).toHaveBeenCalledOnce());
  await vi.waitFor(() =>
    expect(
      store.session(id).session.blocks.find((block) => block.id === "redirect")?.draft,
    ).toBeUndefined(),
  );
  expect(provider.send).toHaveBeenCalledOnce();
  expect(store.session(id).runId).toBe(runId);
  expect(store.session(id).session.blocks.filter((block) => block.id === "redirect")).toHaveLength(
    1,
  );
  expect(() => engine.command({ ...command, commandId: "stale", runId: "old" })).toThrow();
});

it("stops only the exact delegated task of the active host run and deduplicates receipt replay", async () => {
  const { engine, store, id, provider, turns } = setup("claude");
  expect(engine.supportsItemStop("claude")).toBe(false);
  provider.stopItem = vi.fn(async () => {});
  expect(engine.supportsItemStop("claude")).toBe(true);
  engine.command({ type: "send", commandId: "parent-start", sessionId: id, text: "Delegate review" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  turns[0].input.onAccepted?.();
  turns[0].input.onEvent({ type: "tool.updated", callId: "agent-call", kind: "agent", status: "running", agentPrompt: "Review" });
  turns[0].input.onEvent({ type: "agent.step", callId: "agent-call", stepId: "step", kind: "message", text: "Inspecting" });
  await vi.waitFor(() => expect(store.session(id).session.blocks.some((entry) => entry.agentRun && entry.tool?.callId === "agent-call")).toBe(true));
  const current = store.session(id);
  const block = current.session.blocks.find((entry) => entry.tool?.callId === "agent-call")!;
  const command = { type: "stopItem", commandId: "stop-child", sessionId: id, runId: current.runId, blockId: block.id, callId: "agent-call" };
  expect(() => engine.command({ ...command, commandId: "wrong-call", callId: "different" })).toThrow();
  expect(() => engine.command({ ...command, commandId: "wrong-run", runId: "earlier" })).toThrow();
  const receipt = engine.command(command);
  expect(engine.command(command)).toEqual(receipt);
  await vi.waitFor(() => expect(provider.stopItem).toHaveBeenCalledExactlyOnceWith(id, "agent-call"));
  expect(provider.cancel).not.toHaveBeenCalled();
  expect(provider.stop).not.toHaveBeenCalled();
  expect(store.session(id).status).toBe("running");
  expect(store.session(id).session.blocks.find((entry) => entry.id === block.id)?.tool?.status).toBe("running");
  turns[0].finish();
  await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
});

it("rejects a historical pending agent block during a newer parent run and never cancels unsupported providers", async () => {
  const { engine, store, id, provider, turns } = setup("claude");
  engine.command({ type: "send", commandId: "old-parent", sessionId: id, text: "Old task" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  turns[0].input.onAccepted?.();
  turns[0].input.onEvent({ type: "tool.updated", callId: "old-call", kind: "agent", status: "running", agentPrompt: "Old review" });
  turns[0].input.onEvent({ type: "agent.step", callId: "old-call", stepId: "step", kind: "message", text: "Inspecting" });
  await vi.waitFor(() => expect(store.session(id).session.blocks.some((entry) => entry.agentRun && entry.tool?.callId === "old-call")).toBe(true));
  const old = store.session(id).session.blocks.find((entry) => entry.tool?.callId === "old-call")!;
  const unsupported = { type: "stopItem", commandId: "unsupported", sessionId: id, runId: store.session(id).runId, blockId: old.id, callId: "old-call" };
  expect(() => engine.command(unsupported)).toThrow(/provider cannot stop/);
  expect(provider.cancel).not.toHaveBeenCalled();
  turns[0].finish();
  await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
  provider.stopItem = vi.fn(async () => {});
  const prior = store.session(id);
  store.save({ ...prior, revision: prior.revision + 1, session: { ...prior.session, blocks: prior.session.blocks.map((entry) => entry.id === old.id
    ? { ...entry, tool: { ...entry.tool!, status: "running" }, agentRun: { ...entry.agentRun!, endedAt: undefined } } : entry) } }, { type: "test.pendingHistoricalAgent" });
  engine.command({ type: "send", commandId: "new-parent", sessionId: id, text: "New task" });
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  const current = store.session(id);
  expect(current.session.blocks.find((entry) => entry.id === old.id)?.tool?.status).toBe("running");
  expect(() => engine.command({ ...unsupported, commandId: "stale-agent", runId: current.runId })).toThrow(/subagent changed/);
  expect(provider.stopItem).not.toHaveBeenCalled();
  turns[1].finish();
  await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
});

it("previews contextual transfers without execution and creates an idle handoff with the exact reviewed brief", async () => {
  const { engine, store, id, provider, turns } = setup();
  engine.command({ type: "send", commandId: "source-context", sessionId: id, text: "Implement search" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  turns[0].input.onEvent({ type: "message.delta", text: "Search implemented with keyboard support." });
  turns[0].finish();
  await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
  const source = store.session(id);
  const reply = source.session.blocks.find((block) => block.role === "assistant")!;
  const input = { sessionId: id, sourceBlockId: reply.id, expectedRevision: source.revision,
    mode: "handoff", harness: "claude", model: "claude:test", modelSettings: {} };
  const preview = engine.previewContextual(input);
  expect(provider.send).toHaveBeenCalledTimes(1);
  expect(preview.account).toBe("host-default");
  expect(preview.contextText).toContain("Search implemented");
  const command = { ...input, type: "contextual", commandId: "handoff-context", previewDigest: preview.digest };
  const receipt = engine.command(command);
  expect(engine.command(command)).toEqual(receipt);
  expect(receipt.sessionId).not.toBe(id);
  const destination = store.session(receipt.sessionId);
  expect(destination.status).toBe("idle");
  expect(destination.session.harness).toBe("claude");
  expect(destination.session.blocks.find((block) => block.handoff)?.text).toBe(preview.contextText);
  expect(destination.session.cwd).toBe(source.session.cwd);
  expect(destination.session.runtimeMode).toBe(source.session.runtimeMode);
  expect(store.session(id)).toEqual(source);
  expect(provider.send).toHaveBeenCalledTimes(1);
});

it("binds second opinion to the reviewed source and target with one explicit new request", async () => {
  const { engine, store, id, provider, turns } = setup();
  engine.command({ type: "send", commandId: "source-second", sessionId: id, text: "Review search" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  turns[0].input.onEvent({ type: "message.delta", text: "The search is correct." });
  turns[0].finish();
  await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
  const source = store.session(id);
  const reply = source.session.blocks.find((block) => block.role === "assistant")!;
  const input = { sessionId: id, sourceBlockId: reply.id, expectedRevision: source.revision,
    mode: "secondOpinion", harness: "claude", model: "claude:test", modelSettings: {} };
  const preview = engine.previewContextual(input);
  expect(() => engine.command({ ...input, type: "contextual", commandId: "wrong-target-context", model: "changed", previewDigest: preview.digest })).toThrow(/reviewed context changed/);
  expect(() => engine.previewContextual({ ...input, providerAccountId: "other-account" })).toThrow(/default account/);
  const command = { ...input, type: "contextual", commandId: "second-context", previewDigest: preview.digest };
  const receipt = engine.command(command);
  expect(engine.command(command)).toEqual(receipt);
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  expect(turns[1].input.sessionId).toBe(receipt.sessionId);
  expect(turns[1].input.text).toContain(preview.contextText);
  expect(turns[1].input.text).toContain("The search is correct");
  expect(store.session(receipt.sessionId).session.blocks.find((block) => block.role === "user")?.secondOpinion).toMatchObject({ from: "codex", to: "claude" });
  expect(store.session(id)).toEqual(source);
  expect(provider.send).toHaveBeenCalledTimes(2);
  turns[1].finish();
  await vi.waitFor(() => expect(store.session(receipt.sessionId).status).toBe("idle"));
  engine.updateSession(id, { title: "Changed source" });
  expect(() => engine.command({ ...command, commandId: "stale-source-context" })).toThrow(/source conversation changed/);
});

it("previews a desktop-only source without adoption and rechecks its exact context after explicit adoption", async () => {
  const { engine, store, id, provider, turns } = setup();
  engine.command({ type: "send", commandId: "desktop-source-turn", sessionId: id, text: "Continue search" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  turns[0].input.onEvent({ type: "message.delta", text: "Search work is ready." });
  turns[0].finish();
  await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
  const base = store.session(id);
  const epoch = Date.now();
  const desktop = { ...base, desktop: undefined, revision: epoch, updatedAt: epoch,
    session: { ...base.session, id: "desktop-source-only" } };
  const reply = desktop.session.blocks.find((block) => block.role === "assistant")!;
  const input = { sessionId: desktop.session.id, sourceBlockId: reply.id, expectedRevision: desktop.revision,
    mode: "handoff", harness: "claude", model: "claude:test", modelSettings: {} };
  const preview = engine.previewContextual(input, desktop);
  expect(() => store.session(desktop.session.id)).toThrow();
  expect(provider.send).toHaveBeenCalledTimes(1);
  engine.adoptSession(desktop);
  const receipt = engine.command({ ...input, type: "contextual", commandId: "desktop-handoff", previewDigest: preview.digest });
  expect(store.session(receipt.sessionId).session.blocks.find((block) => block.handoff)?.text).toBe(preview.contextText);
  expect(store.session(desktop.session.id).session.blocks).toEqual(desktop.session.blocks);
  expect(provider.send).toHaveBeenCalledTimes(1);
});

it("Stop cancels a host follow-up waiting for provider startup", async () => {
  const { engine, store, id, provider, turns } = setup();
  provider.steer = vi.fn(async () => {});
  engine.command({ type: "send", commandId: "start", sessionId: id, text: "first" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  const runId = store.session(id).runId!;
  engine.command({ type: "steer", commandId: "redirect", sessionId: id, runId, text: "second" });
  engine.command({ type: "cancel", commandId: "stop", sessionId: id, runId });
  await vi.waitFor(() => expect(store.session(id).status).not.toBe("running"));
  expect(provider.steer).not.toHaveBeenCalled();
  expect(provider.send).toHaveBeenCalledOnce();
  expect(store.session(id).session.blocks.find((block) => block.id === "redirect")).toMatchObject({
    draft: true,
    followUpDelivery: "undelivered",
    text: "second",
  });
});

it("retains rejected follow-ups and their attachments as drafts without replaying ambiguous delivery", async () => {
  const { engine, store, id, provider, turns } = setup();
  provider.steer = vi.fn(async () => {
    throw new Error("transport closed before acknowledgement");
  });
  const file = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "notes.txt",
    mimeType: "text/plain",
    kind: "file",
    size: 5,
  };
  await writeAttachmentChunk(store, {
    id: file.id,
    offset: 0,
    size: 5,
    data: Buffer.from("notes").toString("base64"),
  });
  engine.command({ type: "send", commandId: "start", sessionId: id, text: "first" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  turns[0].input.onAccepted?.();
  const command = {
    type: "steer",
    commandId: "rejected",
    sessionId: id,
    runId: store.session(id).runId,
    text: "keep this follow-up",
    attachments: [file],
  };
  const receipt = engine.command(command);
  await vi.waitFor(() =>
    expect(
      store
        .session(id)
        .session.blocks.some((block) => block.text.includes("Could not confirm delivery")),
    ).toBe(true),
  );
  turns[0].finish();
  await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
  expect(
    store.session(id).session.blocks.find((block) => block.id === command.commandId),
  ).toMatchObject({
    draft: true,
    followUpDelivery: "uncertain",
    text: command.text,
    attachments: [{ ...file, path: expect.any(String) }],
  });
  expect(engine.command(command)).toEqual(receipt);
  expect(provider.steer).toHaveBeenCalledOnce();
  engine.command({
    type: "send",
    commandId: "unrelated",
    sessionId: id,
    text: "another explicit prompt",
  });
  expect(
    store.session(id).session.blocks.find((block) => block.id === command.commandId)?.draft,
  ).toBe(true);
});

it("keeps every accepted follow-up when the primary turn settles before startup acceptance", async () => {
  const { engine, store, id, provider, turns } = setup();
  provider.steer = vi.fn(async () => {});
  engine.command({ type: "send", commandId: "start", sessionId: id, text: "first" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  for (const commandId of ["waiting-a", "waiting-b"]) {
    engine.command({
      type: "steer",
      commandId,
      sessionId: id,
      runId: store.session(id).runId,
      text: commandId,
    });
  }
  turns[0].finish();
  await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
  expect(provider.steer).not.toHaveBeenCalled();
  expect(store.session(id).session.blocks.filter((block) => block.draft)).toMatchObject([
    { id: "waiting-a", text: "waiting-a", followUpDelivery: "undelivered" },
    { id: "waiting-b", text: "waiting-b", followUpDelivery: "undelivered" },
  ]);
  engine.command({
    type: "send",
    commandId: "retry-a",
    sessionId: id,
    draftBlockId: "waiting-a",
    text: "waiting-a",
  });
  expect(store.session(id).session.blocks.some((block) => block.id === "waiting-a")).toBe(false);
  expect(store.session(id).session.blocks.find((block) => block.id === "waiting-b")?.draft).toBe(
    true,
  );
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  expect(turns[1].input.text).toBe("waiting-a");
});

it("does not expose an idle session before in-flight follow-up delivery retires", async () => {
  const { engine, store, id, provider, turns } = setup();
  let rejectSteer!: (reason: Error) => void;
  provider.steer = vi.fn(
    () =>
      new Promise<void>((_, reject) => {
        rejectSteer = reject;
      }),
  );
  engine.command({ type: "send", commandId: "start", sessionId: id, text: "first" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  turns[0].input.onAccepted?.();
  engine.command({
    type: "steer",
    commandId: "in-flight",
    sessionId: id,
    runId: store.session(id).runId,
    text: "second",
  });
  await vi.waitFor(() => expect(provider.steer).toHaveBeenCalledOnce());
  turns[0].finish();
  await vi.waitFor(() => expect(provider.stop).toHaveBeenCalled());
  expect(store.session(id).status).toBe("running");
  expect(() =>
    engine.command({ type: "send", commandId: "too-soon", sessionId: id, text: "third" }),
  ).toThrow("already running");
  rejectSteer(new Error("provider retired"));
  await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
  expect(store.session(id).session.blocks.find((block) => block.id === "in-flight")).toMatchObject({
    draft: true,
    followUpDelivery: "uncertain",
  });
});

it("persists the accepted run ID in receipts even after a replacement turn starts", async () => {
  const { engine, store, id, turns } = setup();
  const command = { type: "send", commandId: "first", sessionId: id, text: "first" };
  const receipt = engine.command(command);
  expect(receipt.runId).toBe(store.session(id).runId);
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  turns[0].finish();
  await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
  engine.command({ type: "send", commandId: "replacement", sessionId: id, text: "second" });
  expect(store.session(id).runId).not.toBe(receipt.runId);
  expect(engine.command(command)).toEqual(receipt);
  expect(store.receiptStatus(command.commandId)?.runId).toBe(receipt.runId);
});

it("keeps a follow-up uncertain when Stop makes its provider resolve without delivery", async () => {
  const { engine, store, id, provider, turns } = setup();
  let finishSteer!: () => void;
  provider.steer = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishSteer = resolve;
      }),
  );
  engine.command({ type: "send", commandId: "start", sessionId: id, text: "first" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  turns[0].input.onAccepted?.();
  const runId = store.session(id).runId!;
  engine.command({
    type: "steer",
    commandId: "redirect",
    sessionId: id,
    runId,
    text: "retain this",
  });
  await vi.waitFor(() => expect(provider.steer).toHaveBeenCalledOnce());
  engine.command({ type: "cancel", commandId: "stop", sessionId: id, runId });
  finishSteer();
  await vi.waitFor(() => expect(store.session(id).status).not.toBe("running"));
  expect(store.session(id).session.blocks.find((block) => block.id === "redirect")).toMatchObject({
    draft: true,
    followUpDelivery: "uncertain",
    text: "retain this",
  });
});

it("protects a delivery draft from removal until the host turn retires", async () => {
  const { engine, store, id, provider, turns } = setup();
  let finishSteer!: () => void;
  provider.steer = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishSteer = resolve;
      }),
  );
  engine.command({ type: "send", commandId: "start", sessionId: id, text: "first" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  engine.command({
    type: "steer",
    commandId: "redirect",
    sessionId: id,
    runId: store.session(id).runId!,
    text: "retain this",
  });
  expect(() =>
    engine.command({
      type: "removeDraft",
      commandId: "remove-pending",
      sessionId: id,
      draftBlockId: "redirect",
    }),
  ).toThrow("delivery is still active");
  turns[0].input.onAccepted?.();
  await vi.waitFor(() => expect(provider.steer).toHaveBeenCalledOnce());
  expect(() =>
    engine.command({
      type: "removeDraft",
      commandId: "remove-in-flight",
      sessionId: id,
      draftBlockId: "redirect",
    }),
  ).toThrow("delivery is still active");
  turns[0].finish();
  await vi.waitFor(() => expect(provider.stop).toHaveBeenCalled());
  finishSteer();
  await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
  engine.command({
    type: "removeDraft",
    commandId: "remove-retired",
    sessionId: id,
    draftBlockId: "redirect",
  });
  expect(store.session(id).session.blocks.some((block) => block.id === "redirect")).toBe(false);
});

it("restores pending and uncertain follow-up drafts after restart without replay", async () => {
  const { store, provider, directory, id } = setup();
  const current = store.session(id);
  store.save(
    {
      ...current,
      revision: current.revision + 1,
      status: "running",
      runId: "interrupted-run",
      session: {
        ...current.session,
        busy: true,
        blocks: [
          {
            id: "not-started",
            role: "user",
            text: "retain unsent",
            draft: true,
            followUpDelivery: "pending",
          },
          {
            id: "possibly-sent",
            role: "user",
            text: "inspect before retry",
            draft: true,
            followUpDelivery: "uncertain",
          },
        ],
      },
    },
    { type: "fixture" },
  );
  const reopened = new HostStore(join(directory, "host.db"));
  const restarted = new HostEngine(reopened, { codex: provider });
  cleanups.push(async () => {
    await restarted.close();
    reopened.close();
  });
  expect(reopened.session(id).status).toBe("interrupted");
  expect(reopened.session(id).session.blocks.filter((block) => block.draft)).toMatchObject([
    { id: "not-started", followUpDelivery: "undelivered", draft: true },
    { id: "possibly-sent", followUpDelivery: "uncertain", draft: true },
  ]);
  expect(provider.send).not.toHaveBeenCalled();
});

it("atomically creates a first turn and deduplicates a lost reply", async () => {
  const { engine, store, project, provider } = setup();
  const command = {
    type: "create",
    commandId: "atomic",
    projectId: project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
    firstTurn: { type: "send", commandId: "first", sessionId: "", text: "hello" },
  };
  const receipt = engine.command(command);
  expect(receipt.runId).toBe(store.session(receipt.sessionId).runId);
  expect(engine.command(command)).toEqual(receipt);
  expect(
    store.session(receipt.sessionId).session.blocks.filter((block) => block.role === "user"),
  ).toHaveLength(1);
  await vi.waitFor(() => expect(provider.send).toHaveBeenCalledTimes(1));
  expect(store.sessions(project.id)).toHaveLength(2);
  expect(() =>
    engine.command({ ...command, firstTurn: { ...command.firstTurn, text: "changed" } }),
  ).toThrow();
});

it("rolls back creation and avoids provider dispatch when the first turn fails", () => {
  const { engine, store, project, provider } = setup();
  const command = {
    type: "create",
    commandId: "failed-atomic",
    projectId: project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
    firstTurn: {
      type: "send",
      commandId: "first",
      sessionId: "",
      text: "hello",
      attachments: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          name: "missing",
          size: 1,
          mimeType: "text/plain",
          kind: "file",
        },
      ],
    },
  };
  expect(() => engine.command(command)).toThrow();
  expect(store.sessions(project.id)).toHaveLength(1);
  expect(provider.send).not.toHaveBeenCalled();
});

it("recovers the same atomic receipt after reopening the durable store", () => {
  const { engine, directory, project } = setup();
  const command = {
    type: "create",
    commandId: "durable-atomic",
    projectId: project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
    firstTurn: { type: "send", commandId: "durable-first", sessionId: "", text: "once" },
  };
  const receipt = engine.command(command);
  const reopened = new HostStore(join(directory, "host.db"));
  const send = vi.fn(async () => {});
  const restarted = new HostEngine(reopened, {
    codex: {
      send,
      bind: vi.fn(),
      stop: async () => {},
      cancel: async () => {},
      approve: vi.fn(),
      answer: vi.fn(),
    },
  });
  cleanups.push(async () => {
    await restarted.close();
    reopened.close();
  });
  expect(restarted.command(command)).toEqual(receipt);
  expect(send).not.toHaveBeenCalled();
  expect(
    reopened.session(receipt.sessionId).session.blocks.filter((block) => block.role === "user"),
  ).toHaveLength(1);
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function setup(harness: RemoteProvider = "codex") {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-engine-test-"));
  const store = new HostStore(join(directory, "host.db"));
  const project = store.addProject(directory, "Test");
  const turns: Array<{ input: SendTurnInput; finish: () => void }> = [];
  const provider: HostProvider = {
    send: vi.fn(
      (input) =>
        new Promise<void>((resolve) => {
          turns.push({ input, finish: resolve });
        }),
    ),
    cancel: vi.fn(async () => {
      turns.at(-1)?.finish();
    }),
    stop: vi.fn(async () => {
      turns.at(-1)?.finish();
    }),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const engine = new HostEngine(store, Object.fromEntries(REMOTE_PROVIDERS.map((id) => [id, provider])));
  const created = engine.command({
    type: "create",
    commandId: "create",
    projectId: project.id,
    harness,
    model: `${harness}:test`,
    runtimeMode: "supervised",
  });
  cleanups.push(async () => {
    await engine.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    store,
    provider,
    project,
    engine,
    turns,
    id: created.sessionId,
  };
}

describe("headless session ownership", () => {
  it.each(REMOTE_PROVIDERS)("rewinds durably and sends only retained context for %s", async (harness) => {
    const { engine, store, provider, turns, id } = setup(harness);
    const initial = store.session(id);
    store.save(
      {
        ...initial,
        revision: initial.revision + 1,
        session: {
          ...initial.session,
          providerSessionId: "provider-thread",
          blocks: [
            { id: "u1", role: "user", text: "Keep this request" },
            { id: "a1", role: "assistant", text: "Keep this answer" },
            { id: "u2", role: "user", text: "Remove this request" },
            { id: "a2", role: "assistant", text: "Remove this answer" },
          ],
        },
      },
      { type: "test.seed" },
    );
    const before = store.session(id).revision;
    const rewind = {
      type: "rewind",
      commandId: "rewind-one",
      sessionId: id,
      blockId: "u2",
    };
    const receipt = await engine.rewind(rewind);
    expect(receipt.revision).toBe(before + 1);
    expect(provider.stop).toHaveBeenCalledWith(id);
    const saved = store.session(id);
    expect(saved.session.blocks.map((block) => block.id)).toEqual(["u1", "a1"]);
    expect(saved.session.providerSessionId).toBeUndefined();
    expect(saved.session.rewindHistory).toHaveLength(1);
    expect(saved.session.pendingContextReplay).toContain("Keep this request");
    expect(saved.session.pendingContextReplay).toContain("Keep this answer");

    engine.command({ type: "send", commandId: "after-rewind", sessionId: id, text: "Continue" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(turns[0].input.text).toContain("Keep this request");
    expect(turns[0].input.text).not.toContain("Remove this request");
    expect(turns[0].input.text).not.toContain("Remove this answer");
    expect(store.session(id).session.pendingContextReplay).toBeTruthy();
    turns[0].input.onAccepted?.();
    expect(store.session(id).session.pendingContextReplay).toBeUndefined();
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
  });

  it("uses native rewind for the latest editable Codex turn and preserves the resulting provider binding", async () => {
    const { engine, store, provider, id } = setup();
    provider.rewind = vi.fn(async (input) => {
      input.onEvent({ type: "session.providerBound", providerSessionId: "forked-thread" });
      return { submitted: false };
    });
    const initial = store.session(id);
    store.save(
      {
        ...initial,
        revision: initial.revision + 1,
        session: {
          ...initial.session,
          providerSessionId: "provider-thread",
          blocks: [
            { id: "prior", role: "user", text: "Earlier turn", providerTurnId: "turn-1" },
            { id: "latest-a", role: "user", text: "First grouped message", providerTurnId: "turn-2" },
            { id: "latest-b", role: "user", text: "Last grouped message", providerTurnId: "turn-2" },
          ],
        },
      },
      { type: "test.seed" },
    );
    await engine.rewind({
      type: "rewind",
      commandId: "native-rewind",
      sessionId: id,
      blockId: "latest-b",
    });
    expect(provider.rewind).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: id,
      providerTurnId: "turn-2",
    }));
    expect(provider.stop).not.toHaveBeenCalled();
    expect(store.session(id).session.blocks.map((block) => block.id)).toEqual(["prior"]);
    expect(store.session(id).session.providerSessionId).toBe("forked-thread");
    expect(store.session(id).session.pendingContextReplay).toBeUndefined();
  });

  it("keeps the visible transcript when a native rewind commits unsuccessfully and prepares fresh replay", async () => {
    const { engine, store, provider, turns, id } = setup();
    provider.rewind = vi.fn(async () => ({ submitted: false }));
    const initial = store.session(id);
    store.save(
      {
        ...initial,
        revision: initial.revision + 1,
        session: {
          ...initial.session,
          providerSessionId: "provider-thread",
          blocks: [
            { id: "prior", role: "user", text: "Retain this request", providerTurnId: "turn-1" },
            { id: "latest", role: "user", text: "This must remain visible", providerTurnId: "turn-2" },
          ],
        },
      },
      { type: "test.seed" },
    );
    const before = store.session(id);
    const failFirstSave = vi.spyOn(store, "save").mockImplementationOnce(() => {
      throw new Error("disk full");
    });

    await expect(engine.rewind({
      type: "rewind",
      commandId: "native-commit-failure",
      sessionId: id,
      blockId: "latest",
    })).rejects.toThrow("disk full");

    const recovered = store.session(id);
    expect(recovered.session.blocks).toEqual(before.session.blocks);
    expect(recovered.session.rewindHistory).toEqual(before.session.rewindHistory);
    expect(recovered.session.providerSessionId).toBeUndefined();
    expect(recovered.session.pendingContextReplay).toContain("Retain this request");
    expect(provider.stop).toHaveBeenCalledWith(id);
    failFirstSave.mockRestore();

    engine.command({ type: "send", commandId: "fresh-after-native-error", sessionId: id, text: "Continue" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(turns[0].input.text).toContain("Retain this request");
    expect(turns[0].input.text).toContain("This must remain visible");
  });

  it("rejects competing host commands while provider cleanup for rewind is pending", async () => {
    const { engine, store, provider, id } = setup();
    const initial = store.session(id);
    store.save(
      {
        ...initial,
        revision: initial.revision + 1,
        session: {
          ...initial.session,
          blocks: [
            { id: "kept", role: "user", text: "keep" },
            { id: "removed", role: "user", text: "remove" },
          ],
        },
      },
      { type: "test.seed" },
    );
    let finishStop!: () => void;
    provider.stop = vi.fn(() => new Promise<void>((resolve) => { finishStop = resolve; }));
    const rewinding = engine.rewind({
      type: "rewind",
      commandId: "locked-rewind",
      sessionId: id,
      blockId: "removed",
    });
    await vi.waitFor(() => expect(provider.stop).toHaveBeenCalledOnce());
    expect(() => engine.command({
      type: "send",
      commandId: "blocked-send",
      sessionId: id,
      text: "must wait",
    })).toThrow("conversation change is in progress");
    finishStop();
    await expect(rewinding).resolves.toMatchObject({ commandId: "locked-rewind" });
  });

  it("rejects a rewind against a stale remote session revision before provider mutation", async () => {
    const { engine, store, provider, id } = setup();
    provider.rewind = vi.fn(async () => ({ submitted: false }));
    const initial = store.session(id);
    const staleRevision = initial.revision;
    store.save(
      {
        ...initial,
        revision: initial.revision + 1,
        session: {
          ...initial.session,
          providerSessionId: "provider-thread",
          blocks: [
            { id: "kept", role: "user", text: "keep" },
            { id: "latest", role: "user", text: "rewind this", providerTurnId: "turn-2" },
          ],
        },
      },
      { type: "test.seed" },
    );
    await expect(engine.rewind({
      type: "rewind",
      commandId: "stale-rewind",
      sessionId: id,
      blockId: "latest",
      expectedRevision: staleRevision,
    })).rejects.toThrow("changed; refresh");
    expect(provider.rewind).not.toHaveBeenCalled();
    expect(provider.stop).not.toHaveBeenCalled();
    expect(store.session(id).session.blocks.map((block) => block.id)).toEqual(["kept", "latest"]);
  });

  it("applies host skill instructions while retaining the original user transcript", async () => {
    const { engine, store, turns, id, directory } = setup("claude");
    const folder = join(directory, ".agents/skills/remote-review");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "SKILL.md"), "Use the host review checklist");
    engine.command({
      type: "send",
      commandId: "remote-skill",
      sessionId: id,
      text: "/remote-review inspect",
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(turns[0].input.text).toContain("Use the host review checklist");
    expect(store.session(id).session.blocks.find((block) => block.role === "user")?.text).toBe(
      "/remote-review inspect",
    );
  });
  it.each([
    "earlier text",
    "earlier metadata",
    "tail text",
    "tail metadata",
    "append",
    "remove",
  ])("refreshes %s even with equal revisions", (change) => {
    const { engine, store, id } = setup("claude");
    const base = store.session(id);
    const adopted = store.save(
      {
        ...base,
        revision: base.revision + 1,
        desktop: { updatedAt: 1, revision: base.revision + 1 },
        session: {
          ...base.session,
          blocks: [
            { id: "u1", role: "user", text: "Start" },
            { id: "a1", role: "assistant", text: "Done" },
          ],
        },
      },
      { type: "test.adopted" },
    );
    const snapshot = structuredClone(adopted);
    snapshot.updatedAt = adopted.updatedAt + 1000;
    delete snapshot.blockRevisions;
    if (change === "earlier text") snapshot.session.blocks[0].text = "Edited";
    if (change === "earlier metadata") snapshot.session.blocks[0].tool = { detail: "Edited" };
    if (change === "tail text") snapshot.session.blocks[1].text = "Edited";
    if (change === "tail metadata") snapshot.session.blocks[1].tool = { detail: "Edited" };
    if (change === "append") snapshot.session.blocks.push({ id: "u2", role: "user", text: "Next" });
    if (change === "remove") snapshot.session.blocks.pop();
    expect(snapshot.revision).toBe(adopted.revision);
    const refreshed = engine.refreshFromDesktop(snapshot)!;
    expect(refreshed.session.blocks).toEqual(snapshot.session.blocks);
    expect(refreshed.session.blocks).not.toEqual(adopted.session.blocks);
  });

  it("recognizes identical blocks with unrelated desktop revisions and no block revision metadata", () => {
    const { engine, store, id } = setup("claude");
    const base = store.session(id);
    const adopted = store.save(
      {
        ...base,
        revision: base.revision + 1,
        desktop: { updatedAt: 1, revision: base.revision + 1 },
        session: { ...base.session, blocks: [{ id: "u1", role: "user", text: "Start" }] },
      },
      { type: "test.adopted" },
    );
    const snapshot = structuredClone(adopted);
    snapshot.updatedAt = adopted.updatedAt + 1000;
    snapshot.revision = snapshot.updatedAt;
    delete snapshot.blockRevisions;
    const save = vi.spyOn(store, "save");
    expect(engine.refreshFromDesktop(snapshot)?.session.blocks).toEqual(adopted.session.blocks);
    expect(save.mock.calls.at(-1)?.[1]).toEqual({ type: "desktopSeen" });
  });

  it("keeps a turn's output over a desktop copy saved before it ended", async () => {
    const { engine, store, turns, id } = setup("claude");
    engine.command({ type: "send", commandId: "send", sessionId: id, text: "Review it" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    // The desktop mirrors the session while the turn is still running.
    const midTurn = structuredClone(store.session(id));
    midTurn.updatedAt = Date.now();
    midTurn.status = "idle";
    await new Promise((resolve) => setTimeout(resolve, 5));
    turns[0].input.onEvent({ type: "message.delta", text: "VERDICT: PASS" });
    turns[0].input.onEvent({ type: "message.completed" });
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));

    engine.refreshFromDesktop(midTurn);
    const reply = (blocks: { role: string; text: string }[]) =>
      blocks.find((block) => block.role === "assistant")?.text;
    expect(reply(store.session(id).session.blocks)).toBe("VERDICT: PASS");

    // A newer desktop copy that never mirrored the host turn cannot erase it.
    const missing = structuredClone(store.session(id));
    missing.updatedAt = Date.now() + 1000;
    missing.session.blocks = missing.session.blocks.filter((block) => block.role === "user");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    engine.refreshFromDesktop(missing);
    expect(reply(store.session(id).session.blocks)).toBe("VERDICT: PASS");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("is behind it"));
    warn.mockRestore();

    // A turn the desktop ran later, after the host turn, still catches up.
    const later = structuredClone(store.session(id));
    later.updatedAt = Date.now() + 2000;
    later.session.blocks.push(
      { id: "desk-user", role: "user", text: "Continue here" },
      { id: "desk-reply", role: "assistant", text: "Continued on the desktop" },
    );
    engine.refreshFromDesktop(later);
    expect(store.session(id).session.blocks.at(-1)?.text).toBe("Continued on the desktop");
    expect(store.session(id).desktop?.revision).toBe(store.session(id).revision);
  });

  it("keeps a host turn when a newer desktop copy diverged, and accepts edits once matched", async () => {
    const { engine, store, id } = setup("claude");
    const base = store.session(id);
    const adopted = store.save(
      {
        ...base,
        revision: base.revision + 1,
        desktop: { updatedAt: 1, revision: base.revision + 1 },
        session: {
          ...base.session,
          blocks: [
            { id: "u1", role: "user", text: "Start" },
            { id: "a1", role: "assistant", text: "Started" },
          ],
        },
      },
      { type: "test.adopted" },
    );
    // The host matched the desktop and nothing ran since: a desktop edit wins.
    const rewound = structuredClone(adopted);
    rewound.updatedAt = Date.now() + 1000;
    rewound.session.blocks = [{ id: "u1", role: "user", text: "Start" }];
    engine.refreshFromDesktop(rewound);
    expect(store.session(id).session.blocks.map((block) => block.id)).toEqual(["u1"]);

    // A remote message ran here, then the desktop ran a different turn.
    const hosted = store.session(id);
    store.save(
      {
        ...hosted,
        revision: hosted.revision + 1,
        session: {
          ...hosted.session,
          blocks: [
            ...hosted.session.blocks,
            { id: "phone", role: "user", text: "From the phone" },
            {
              id: "writer",
              role: "system",
              notice: "error",
              text: "thread t already has an active writer",
            },
          ],
        },
      },
      { type: "test.remote" },
    );
    const diverged = structuredClone(store.session(id));
    diverged.updatedAt = Date.now() + 2000;
    diverged.session.blocks = [
      { id: "u1", role: "user", text: "Start" },
      { id: "desk", role: "user", text: "From the desktop" },
    ];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    engine.refreshFromDesktop(diverged);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("diverged"));
    warn.mockRestore();
    expect(store.session(id).session.blocks.map((block) => block.id)).toEqual([
      "u1",
      "phone",
      "writer",
    ]);

    // The desktop mirrored the phone message and continued past the failure.
    const continued = structuredClone(store.session(id));
    continued.updatedAt = Date.now() + 3000;
    continued.session.blocks = [
      { id: "u1", role: "user", text: "Start" },
      { id: "phone", role: "user", text: "From the phone" },
      { id: "desk-2", role: "user", text: "Try again" },
    ];
    engine.refreshFromDesktop(continued);
    expect(store.session(id).session.blocks.map((block) => block.id)).toEqual([
      "u1",
      "phone",
      "desk-2",
    ]);
  });

  it("keeps a failure the lagging desktop has not mirrored, and accepts continuations past shared ones", () => {
    const { engine, store, id } = setup("claude");
    const base = store.session(id);
    const failure = {
      id: "writer",
      role: "system" as const,
      notice: "error" as const,
      text: "thread t already has an active writer",
    };
    store.save(
      {
        ...base,
        revision: base.revision + 1,
        desktop: { updatedAt: 1 },
        session: {
          ...base.session,
          blocks: [{ id: "phone", role: "user", text: "From the phone" }, failure],
        },
      },
      { type: "test.remote" },
    );
    // A newer desktop save that has not pulled the failure yet.
    const lagging = structuredClone(store.session(id));
    lagging.updatedAt = Date.now() + 1000;
    lagging.session.blocks = [{ id: "phone", role: "user", text: "From the phone" }];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    engine.refreshFromDesktop(lagging);
    warn.mockRestore();
    expect(store.session(id).session.blocks.at(-1)?.id).toBe("writer");
    expect(sessionIssue(store.session(id).session)).toBe("failed");

    // Both sides hold the old failure; the host then ran a turn the desktop
    // mirrored and continued.
    const hosted = store.session(id);
    store.save(
      {
        ...hosted,
        revision: hosted.revision + 1,
        session: {
          ...hosted.session,
          blocks: [
            ...hosted.session.blocks,
            { id: "retry", role: "user", text: "Try again" },
            { id: "answer", role: "assistant", text: "Done" },
          ],
        },
      },
      { type: "test.remote" },
    );
    const continued = structuredClone(store.session(id));
    continued.updatedAt = Date.now() + 2000;
    continued.session.blocks.push({ id: "desk", role: "user", text: "Thanks" });
    engine.refreshFromDesktop(continued);
    expect(store.session(id).session.blocks.map((block) => block.id)).toEqual([
      "phone",
      "writer",
      "retry",
      "answer",
      "desk",
    ]);
  });

  it("accepts a desktop turn past a message whose attachment the desktop stored without a path", () => {
    const { engine, store, id } = setup("claude");
    const base = store.session(id);
    const file = { id: "f1", name: "a.png", mimeType: "image/png", kind: "image" as const, size: 1 };
    const sent = (path?: string) => ({
      id: "phone",
      role: "user" as const,
      text: "[image1]",
      attachments: [{ ...file, ...(path ? { path } : {}) }],
    });
    store.save(
      {
        ...base,
        revision: base.revision + 1,
        desktop: { updatedAt: 1 },
        session: { ...base.session, blocks: [sent("C:/host/attachments/f1")] },
      },
      { type: "test.remote" },
    );
    const continued = structuredClone(store.session(id));
    continued.updatedAt = Date.now() + 1000;
    continued.session.blocks = [sent(), { id: "desk", role: "user", text: "From the desktop" }];
    engine.refreshFromDesktop(continued);
    expect(store.session(id).session.blocks.map((block) => block.id)).toEqual(["phone", "desk"]);
  });

  describe("a persisted base decides which side changed", () => {
    const user = (id: string, text: string) => ({ id, role: "user" as const, text });
    const reply = (id: string, text: string) => ({ id, role: "assistant" as const, text });
    /** An adopted session whose host and desktop last agreed on `blocks`. */
    function agreed(blocks: ReturnType<typeof user>[], mismatched = false) {
      const fixture = setup("claude");
      const base = fixture.store.session(fixture.id);
      const saved = fixture.store.save(
        {
          ...base,
          revision: base.revision + 1,
          desktop: {
            updatedAt: 1,
            // A revision that no longer says the host is unchanged: only the base can.
            revision: mismatched ? 0 : base.revision + 1,
            base: conversationHead(blocks),
          },
          session: { ...base.session, blocks },
        },
        { type: "test.adopted" },
      );
      return { ...fixture, saved };
    }
    const appended = (value: ReturnType<typeof structuredClone<any>>, ...blocks: any[]) => {
      const snapshot = structuredClone(value);
      snapshot.updatedAt = Date.now() + 5_000;
      delete snapshot.blockRevisions;
      snapshot.session.blocks.push(...blocks);
      return snapshot;
    };

    it("records the head both hold when the host adopts and when it takes the desktop's turns", () => {
      const { engine, store, id, saved } = agreed([user("u1", "Start"), reply("a1", "Done")]);
      expect(store.session(id).desktop?.base).toEqual(conversationHead(saved.session.blocks));
      engine.refreshFromDesktop(appended(saved, user("u2", "More")));
      const after = store.session(id);
      expect(after.session.blocks.map((block) => block.id)).toEqual(["u1", "a1", "u2"]);
      expect(after.desktop?.base).toEqual(conversationHead(after.session.blocks));
    });

    it("takes a desktop rewind when the host has not moved since the base, whatever the revisions say", () => {
      const { engine, store, id, saved } = agreed([user("u1", "Start"), reply("a1", "Done")], true);
      const rewound = structuredClone(saved);
      rewound.updatedAt = Date.now() + 5_000;
      rewound.session.blocks = [user("u1", "Start")];
      engine.refreshFromDesktop(rewound);
      expect(store.session(id).session.blocks.map((block) => block.id)).toEqual(["u1"]);
    });

    it("keeps its own turn and flags it when both sides appended after the same base", () => {
      const { engine, store, id, saved } = agreed([user("u1", "Start")], true);
      store.save(
        {
          ...saved,
          revision: saved.revision + 1,
          session: { ...saved.session, blocks: [...saved.session.blocks, user("phone", "Phone")] },
        },
        { type: "test.remote" },
      );
      const save = vi.spyOn(store, "save");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      engine.refreshFromDesktop(appended(saved, user("desk", "Desktop")));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("diverged"));
      warn.mockRestore();
      expect(save.mock.calls.at(-1)?.[1]).toEqual({ type: "desktopDiverged" });
      expect(store.session(id).session.blocks.map((block) => block.id)).toEqual(["u1", "phone"]);
      // The agreement is not moved by a conflict.
      expect(store.session(id).desktop?.base).toEqual(conversationHead([user("u1", "Start")]));
    });

    it("keeps its own turn when the desktop only lags it", () => {
      const { engine, store, id, saved } = agreed([user("u1", "Start")], true);
      store.save(
        {
          ...saved,
          revision: saved.revision + 1,
          session: { ...saved.session, blocks: [...saved.session.blocks, user("phone", "Phone")] },
        },
        { type: "test.remote" },
      );
      const lagging = structuredClone(saved);
      lagging.updatedAt = Date.now() + 5_000;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      engine.refreshFromDesktop(lagging);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("is behind it"));
      warn.mockRestore();
      expect(store.session(id).session.blocks.map((block) => block.id)).toEqual(["u1", "phone"]);
    });

    it("converges when the desktop keeps its version: its base names the host transcript it replaces", () => {
      const { engine, store, id, saved } = agreed([user("u1", "Start")], true);
      const hosted = store.save(
        {
          ...saved,
          revision: saved.revision + 1,
          session: { ...saved.session, blocks: [...saved.session.blocks, user("phone", "Phone")] },
        },
        { type: "test.remote" },
      );
      const kept = appended(saved, user("desk", "Desktop"));
      kept.session.adoptedBase = conversationHead(hosted.session.blocks);
      engine.refreshFromDesktop(kept);
      expect(store.session(id).session.blocks.map((block) => block.id)).toEqual(["u1", "desk"]);
      expect(store.session(id).desktop?.base).toEqual(
        conversationHead(store.session(id).session.blocks),
      );
      // The host copy carries none of the desktop's own bookkeeping.
      expect(store.session(id).session).not.toHaveProperty("adoptedBase");
    });

    it("compares an adopted copy whose blocks carry files by their digests", () => {
      const file = {
        id: "f1",
        name: "a.png",
        mimeType: "image/png",
        kind: "image" as const,
        size: 1,
      };
      const sent = (path?: string) => ({
        ...user("phone", "[image1]"),
        attachments: [{ ...file, ...(path ? { path } : {}) }],
      });
      const { engine, store, id, saved } = agreed([sent("C:/host/files/f1")] as never, true);
      // The desktop stored the file elsewhere: the same message, one turn further.
      const continued = structuredClone(saved);
      continued.updatedAt = Date.now() + 5_000;
      continued.session.blocks = [sent("D:/desktop/f1"), user("desk", "Next")] as never;
      engine.refreshFromDesktop(continued);
      expect(store.session(id).session.blocks.map((block) => block.id)).toEqual(["phone", "desk"]);
    });
  });

  it("switches a historic chat between providers with context on the next send", async () => {
    const { engine, store, turns, id } = setup("claude");
    const value = store.session(id);
    store.save(
      {
        ...value,
        revision: value.revision + 1,
        session: {
          ...value.session,
          providerSessionId: "old-claude",
          blocks: [
            { id: "earlier", role: "user", text: "Repair the model picker" },
            {
              id: "reply",
              role: "assistant",
              text: "Found the unfiltered host catalog",
            },
          ],
        },
      },
      { type: "session.test" },
    );
    const change = {
      type: "configure",
      commandId: "switch",
      sessionId: id,
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "supervised",
    };
    engine.command(change);
    expect(store.session(id).session).toMatchObject({
      harness: "codex",
      pendingSwitch: { from: "claude" },
    });
    expect(store.session(id).session.providerSessionId).toBeUndefined();
    expect(turns).toHaveLength(0);
    engine.command({
      type: "send",
      commandId: "next",
      sessionId: id,
      text: "Continue the fix",
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(turns[0].input.text).toContain("Repair the model picker");
    expect(turns[0].input.text).toContain("Continue the fix");
    expect(store.session(id).session.blocks).toContainEqual(
      expect.objectContaining({
        role: "handoff",
        handoff: expect.objectContaining({
          from: "claude",
          to: "codex",
          pending: false,
        }),
      }),
    );
    expect(store.session(id).session.pendingSwitch).toBeUndefined();
    turns[0].finish();
  });

  it("restores the original provider conversation when a switch is reverted before sending", () => {
    const { engine, store, provider, id } = setup("claude");
    const value = store.session(id);
    store.save(
      {
        ...value,
        revision: value.revision + 1,
        session: {
          ...value.session,
          providerSessionId: "original",
          blocks: [{ id: "earlier", role: "user", text: "Work" }],
        },
      },
      { type: "session.test" },
    );
    const change = {
      type: "configure",
      sessionId: id,
      modelSettings: {},
      runtimeMode: "supervised",
    };
    engine.command({
      ...change,
      commandId: "switch",
      harness: "codex",
      model: "codex:test",
    });
    engine.command({
      ...change,
      commandId: "revert",
      harness: "claude",
      model: "claude:test",
    });
    expect(store.session(id).session).toMatchObject({
      harness: "claude",
      providerSessionId: "original",
    });
    expect(store.session(id).session.pendingSwitch).toBeUndefined();
    expect(provider.bind).toHaveBeenCalledWith(id, "original", value.session.cwd, undefined);
    expect(() =>
      parseCommand({
        ...change,
        commandId: "bad",
        harness: "invalid",
        model: "bad",
      }),
    ).toThrow("Invalid provider");
  });
  it.each(["send", "compact"] as const)(
    "clears the old draft when a normal %s starts",
    async (type) => {
      const { engine, store, turns, provider, id } = setup();
      provider.compact = (input) => provider.send({ ...input, text: "/compact" });
      engine.command({
        type: "draft",
        commandId: "draft",
        sessionId: id,
        text: "Later",
      });
      engine.command({
        type,
        commandId: "next",
        sessionId: id,
        text: "New work",
      });
      expect(store.session(id).session.blocks.some((block) => block.draft)).toBe(false);
      await vi.waitFor(() => expect(turns).toHaveLength(1));
      turns[0].finish();
    },
  );

  it("contains a persistence failure while requesting approval", async () => {
    const { engine, store, turns, provider, id } = setup();
    engine.command({
      type: "send",
      commandId: "approval-failure",
      sessionId: id,
      text: "Work",
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(store, "save").mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    try {
      expect(() =>
        turns[0].input.onEvent({
          type: "approval.requested",
          requestId: 1,
          title: "Run?",
        }),
      ).not.toThrow();
      await vi.waitFor(() => expect(provider.stop).toHaveBeenCalled());
      await vi.waitFor(() => expect(store.session(id).status).toBe("interrupted"));
    } finally {
      log.mockRestore();
    }
  });

  it("stores a remote draft with an uploaded file, then sends it in plan mode", async () => {
    const { engine, store, turns, id } = setup();
    const fileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(
      await writeAttachmentChunk(store, {
        id: fileId,
        offset: 0,
        size: 5,
        data: Buffer.from("hello").toString("base64"),
      }),
    ).toEqual({ offset: 5 });
    const attachment = {
      id: fileId,
      name: "notes.txt",
      mimeType: "text/plain",
      kind: "file" as const,
      size: 5,
    };
    engine.command({
      type: "draft",
      commandId: "draft-1",
      sessionId: id,
      text: "Plan this",
      attachments: [attachment],
    });
    expect(store.session(id).session.blocks[0]).toMatchObject({
      draft: true,
      attachments: [{ name: "notes.txt" }],
    });
    expect(store.summaries(store.session(id).projectId)[0].draft).toBe(true);
    engine.command({
      type: "send",
      commandId: "send-draft",
      sessionId: id,
      text: "Plan this",
      intent: "plan",
      draftBlockId: "draft-1",
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(turns[0].input).toMatchObject({
      intent: "plan",
      attachments: [{ name: "notes.txt", size: 5 }],
    });
    expect(turns[0].input.attachments?.[0].path).toContain(fileId);
    expect(store.summaries(store.session(id).projectId)[0].draft).toBe(false);
    turns[0].finish();
  });

  it("passes an uploaded image to the host provider on an attachment-only turn", async () => {
    const { engine, store, turns, id } = setup("claude");
    const fileId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const image = Buffer.from("image-bytes");
    await writeAttachmentChunk(store, {
      id: fileId,
      offset: 0,
      size: image.length,
      data: image.toString("base64"),
    });
    engine.command({
      type: "send",
      commandId: "image-turn",
      sessionId: id,
      text: "",
      attachments: [
        {
          id: fileId,
          name: "shot.png",
          mimeType: "image/png",
          kind: "image",
          size: image.length,
        },
      ],
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(turns[0].input.attachments?.[0]).toMatchObject({
      name: "shot.png",
      data: image.toString("base64"),
    });
    expect(await readAttachmentChunk(store, { sessionId: id, id: fileId, offset: 0 })).toEqual({
      offset: image.length,
      size: image.length,
      data: image.toString("base64"),
    });
    const other = engine.command({
      type: "create",
      commandId: "other-session",
      projectId: store.session(id).projectId,
      harness: "claude",
      model: "claude:test",
      runtimeMode: "supervised",
    });
    await expect(
      readAttachmentChunk(store, {
        sessionId: other.sessionId,
        id: fileId,
        offset: 0,
      }),
    ).rejects.toThrow();
    turns[0].finish();
  });

  it("removes a remote draft without starting the provider", () => {
    const { engine, store, provider, id } = setup();
    engine.command({
      type: "draft",
      commandId: "draft-2",
      sessionId: id,
      text: "Later",
    });
    engine.command({
      type: "removeDraft",
      commandId: "remove-2",
      sessionId: id,
      draftBlockId: "draft-2",
    });
    expect(store.session(id).session.blocks).toEqual([]);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("marks a reviewed host plan as built after its build turn", async () => {
    const { engine, store, turns, id } = setup();
    engine.command({
      type: "send",
      commandId: "plan-turn",
      sessionId: id,
      text: "Plan this",
      intent: "plan",
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    turns[0].input.onEvent({ type: "plan", text: "# Steps\n\n1. Change code" });
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    const plan = store.session(id).session.blocks.find((block) => block.role === "plan")!;
    engine.command({
      type: "send",
      commandId: "build-turn",
      sessionId: id,
      text: "Build a stale client copy of the plan",
      intent: "build",
      planBlockId: plan.id,
    });
    expect(
      store.session(id).session.blocks.find((block) => block.id === plan.id)?.plan?.status,
    ).toBe("building");
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    expect(turns[1].input.text).toContain(`<approved_plan>\n${plan.text}\n</approved_plan>`);
    expect(turns[1].input.text).not.toContain("stale client copy");
    turns[1].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    expect(
      store.session(id).session.blocks.find((block) => block.id === plan.id)?.plan?.status,
    ).toBe("built");
  });

  it("requires an explicit pinned build for edited plan commands", () => {
    const command = { type: "send", commandId: "edited", sessionId: "s", text: "# Edited", intent: "build", planBlockId: "p", expectedPlanText: "# Original" };
    expect(parseCommand(command)).toMatchObject(command);
    for (const invalid of [{ ...command, type: "draft" }, { ...command, intent: "plan" },
      { ...command, planBlockId: undefined }, { ...command, draftBlockId: "d" },
      { ...command, expectedPlanText: 42 }, { ...command, expectedPlanText: "bad\0text" }])
      expect(() => parseCommand(invalid)).toThrow();
  });

  it("builds exact edited plan text only against the reviewed base", async () => {
    const { engine, store, turns, id } = setup();
    engine.command({ type: "send", commandId: "review-plan", sessionId: id, text: "Plan this", intent: "plan" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    turns[0].input.onEvent({ type: "plan", text: "# Original\n1. First" });
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    const plan = store.session(id).session.blocks.find((block) => block.role === "plan")!;
    expect(() => engine.command({ type: "send", commandId: "stale-review", sessionId: id,
      text: "# Edited\n1. Second", intent: "build", planBlockId: plan.id, expectedPlanText: "stale" })).toThrow(/reviewed plan changed/);
    expect(store.session(id).status).toBe("idle");
    expect(turns).toHaveLength(1);
    const edited = "# Edited\n1. Second";
    engine.command({ type: "send", commandId: "build-reviewed", sessionId: id,
      text: edited, intent: "build", planBlockId: plan.id, expectedPlanText: plan.text });
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    expect(turns[1].input.text).toContain(`<approved_plan>\n${edited}\n</approved_plan>`);
    expect(store.session(id).session.blocks.find((block) => block.id === plan.id)).toMatchObject({
      text: edited, plan: { status: "building", approvedText: edited, originalText: plan.text, edited: true },
    });
    turns[1].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
  });

  it("captures a text-only host plan and builds its exact stored text after explicit message approval", async () => {
    const { engine, store, turns, id } = setup();
    engine.command({ type: "send", commandId: "text-plan", sessionId: id, text: "Investigate search", intent: "plan" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(turns[0].input.text).toContain("You are in plan mode");
    const text = "# Implementation plan\n\n1. Add search.\n2. Verify keyboard access.";
    turns[0].input.onEvent({ type: "message.delta", text });
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    const plan = store.session(id).session.blocks.find((block) => block.role === "plan")!;
    expect(plan?.text).toBe(text);
    engine.command({ type: "send", commandId: "approve-message", sessionId: id, text: "planı uygula" });
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    expect(turns[1].input.intent).toBe("build");
    expect(turns[1].input.text).toContain(`<approved_plan>\n${text}\n</approved_plan>`);
    expect(store.session(id).session.blocks.find((block) => block.id === plan.id)?.plan).toMatchObject({ status: "building", approvedText: text });
    turns[1].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    expect(store.session(id).session.blocks.find((block) => block.id === plan.id)?.plan?.status).toBe("built");
  });

  it("keeps a manually renamed title when first-turn generation finishes later", async () => {
    const { engine, store, provider, turns, id } = setup();
    let finishTitle: (title: { title: string; workItem: null }) => void = () => {};
    provider.generateTitle = vi.fn(
      () =>
        new Promise((resolve) => {
          finishTitle = resolve;
        }),
    );
    engine.command({
      type: "send",
      commandId: "name-first-turn",
      sessionId: id,
      text: "Fix remote project titles",
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    engine.updateSession(id, { title: "codex · My own title" });
    finishTitle({ title: "Generated title", workItem: null });
    await vi.waitFor(() => expect(provider.generateTitle).toHaveBeenCalledTimes(1));
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    expect(store.session(id).session.title).toBe("codex · My own title");
  });

  it("uses one creation timestamp and advances only updatedAt on later commands", () => {
    let now = 1_700_000_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now++);
    try {
      const { engine, store, project, id } = setup();
      const initial = store.session(id);
      const timestamps = {
        createdAt: initial.createdAt,
        updatedAt: initial.createdAt,
        revision: 1,
      };
      expect(initial).toMatchObject(timestamps);
      expect(store.sessions(project.id)[0]).toMatchObject(timestamps);
      expect(store.summaries(project.id)[0]).toMatchObject(timestamps);

      now = initial.updatedAt + 1_000;
      engine.command({
        type: "configure",
        commandId: "configure-timestamps",
        sessionId: id,
        model: "codex:updated",
        modelSettings: {},
        runtimeMode: "supervised",
      });
      const updatedTimestamps = {
        createdAt: initial.createdAt,
        updatedAt: initial.updatedAt + 1_000,
        revision: 2,
      };
      expect(store.session(id)).toMatchObject(updatedTimestamps);
      expect(store.sessions(project.id)[0]).toMatchObject(updatedTimestamps);
      expect(store.summaries(project.id)[0]).toMatchObject(updatedTimestamps);
    } finally {
      clock.mockRestore();
    }
  });

  it("keeps remote card changes in host history and removes deleted sessions", () => {
    const { store, project, id } = setup();
    const initial = store.summaries(project.id)[0];
    expect(initial.model).toBe("codex:test");
    expect(initial.createdAt).toBe(initial.updatedAt);

    store.save(
      {
        ...store.session(id),
        revision: initial.revision + 1,
        updatedAt: initial.updatedAt + 1_000,
      },
      { type: "session.test" },
    );
    expect(store.summaries(project.id)[0]).toMatchObject({
      createdAt: initial.createdAt,
      updatedAt: initial.updatedAt + 1_000,
    });

    const updated = store.updateSession(id, {
      title: "Codex · Renamed",
      pinned: true,
      archived: true,
      linkedWorkItem: {
        kind: "issue",
        repo: "example/repo",
        number: 42,
        url: "https://github.com/example/repo/issues/42",
      },
    });
    expect(updated).toMatchObject({
      title: "Codex · Renamed",
      pinned: true,
      archived: true,
      model: "codex:test",
      linkedWorkItem: { number: 42 },
    });
    expect(store.summaries(project.id)[0]).toMatchObject({
      title: updated.title,
      pinned: true,
      archived: true,
      revision: updated.revision,
    });
    expect(store.sync(id, initial.revision)).toMatchObject({ kind: "delta" });
    store.updateSession(id, { linkedWorkItem: null });
    expect(store.summaries(project.id)[0].linkedWorkItem).toBeUndefined();

    store.deleteSession(id);
    expect(store.summaries(project.id)).toEqual([]);
    expect(() => store.session(id)).toThrow("Session not found");
  });

  it("includes the harness ID in remote summaries, including older cached rows", () => {
    const { store, project, id } = setup();
    const current = store.session(id);
    store.save(
      {
        ...current,
        revision: current.revision + 1,
        session: { ...current.session, providerSessionId: "harness-session" },
      },
      { type: "session.test" },
    );
    expect(store.summaries(project.id)[0].providerSessionId).toBe("harness-session");

    const legacySummary = { ...store.summaries(project.id)[0] };
    delete legacySummary.providerSessionId;
    store.db
      .prepare("UPDATE session_state SET summary=? WHERE id=?")
      .run(JSON.stringify(legacySummary), id);
    expect(store.summaries(project.id)[0].providerSessionId).toBe("harness-session");
    const repaired = store.db.prepare("SELECT summary FROM session_state WHERE id=?").get(id)!;
    expect(JSON.parse(String(repaired.summary)).providerSessionId).toBe("harness-session");
  });

  it("keeps a legacy session's last known timestamp when adding creation time", () => {
    const { directory, store, project, id } = setup();
    const legacy = { ...store.session(id) };
    delete legacy.createdAt;
    store.db.prepare("UPDATE sessions SET snapshot=? WHERE id=?").run(JSON.stringify(legacy), id);

    const reopened = new HostStore(join(directory, "host.db"));
    cleanups.push(() => reopened.close());
    const original = reopened.session(id);
    reopened.save(
      {
        ...original,
        revision: original.revision + 1,
        updatedAt: original.updatedAt + 1_000,
      },
      { type: "session.test" },
    );
    expect(reopened.summaries(project.id)[0]).toMatchObject({
      createdAt: original.updatedAt,
      updatedAt: original.updatedAt + 1_000,
    });
  });

  it("preserves the transaction error and invalidates cached state if rollback fails", () => {
    const { store, id } = setup();
    const cached = store.session(id);
    store.db.prepare("UPDATE sessions SET snapshot=? WHERE id=?").run(
      JSON.stringify({
        ...cached,
        session: { ...cached.session, title: "Updated" },
      }),
      id,
    );
    const exec = store.db.exec.bind(store.db);
    const rollback = vi.spyOn(store.db, "exec").mockImplementation((sql) => {
      if (sql === "ROLLBACK") throw new Error("rollback failed");
      return exec(sql);
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = new Error("transaction failed");
    try {
      expect(() =>
        store.transaction(() => {
          throw original;
        }),
      ).toThrow(original);
      expect(store.session(id).session.title).toBe("Updated");
    } finally {
      rollback.mockRestore();
      log.mockRestore();
      store.db.exec("ROLLBACK");
    }
  });
  it("keeps the checkout idle while a branch switch is in progress", async () => {
    const { engine, project, id, turns } = setup();
    let finishSwitch = () => {};
    const switching = engine.withIdleProject(
      project.id,
      () =>
        new Promise<void>((resolve) => {
          finishSwitch = resolve;
        }),
    );
    expect(() =>
      engine.command({
        type: "send",
        commandId: "during-switch",
        sessionId: id,
        text: "Work",
      }),
    ).toThrow("branch switch");
    expect(() =>
      engine.command({
        type: "create",
        commandId: "new-during-switch",
        projectId: project.id,
        harness: "codex",
        model: "codex:test",
        runtimeMode: "supervised",
      }),
    ).toThrow("branch switch");
    finishSwitch();
    await switching;
    engine.command({
      type: "send",
      commandId: "after-switch",
      sessionId: id,
      text: "Work",
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    turns[0].finish();
  });

  it("runs provider context compaction once and persists its transcript marker", async () => {
    const { engine, store, provider, id } = setup();
    let finishCompact = () => {};
    provider.compact = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCompact = resolve;
        }),
    );
    const command = { type: "compact", commandId: "compact", sessionId: id };
    const receipt = engine.command(command);
    expect(engine.command(command)).toEqual(receipt);
    await vi.waitFor(() => expect(provider.compact).toHaveBeenCalledTimes(1));
    expect(store.session(id).session.blocks).toContainEqual(
      expect.objectContaining({ text: "/compact" }),
    );
    finishCompact();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
  });

  it("persists model and permission changes for the next turn and rejects changes mid-turn", async () => {
    const { engine, store, turns, id } = setup();
    const change = {
      type: "configure",
      commandId: "settings",
      sessionId: id,
      model: "codex:new",
      modelSettings: { reasoningEffort: "high" },
      runtimeMode: "full-access",
    };
    const receipt = engine.command(change);
    expect(engine.command(change)).toEqual(receipt);
    expect(store.session(id).session).toMatchObject({
      model: "codex:new",
      modelSettings: { reasoningEffort: "high" },
      runtimeMode: "full-access",
    });
    engine.command({
      type: "send",
      commandId: "turn",
      sessionId: id,
      text: "Continue",
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(turns[0].input).toMatchObject({
      model: "codex:new",
      modelSettings: { reasoningEffort: "high" },
      runtimeMode: "full-access",
    });
    expect(() => engine.command({ ...change, commandId: "later" })).toThrow("current turn");
    turns[0].finish();
  });
  it("keeps working with no client, persists output, and deduplicates a lost acknowledgement", async () => {
    const { engine, store, turns, provider, id } = setup();
    const command = {
      type: "send",
      commandId: "send-once",
      sessionId: id,
      text: "Do the work",
    };
    const receipt = engine.command(command);
    expect(engine.command(command)).toEqual(receipt);
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(provider.send).toHaveBeenCalledTimes(1);
    const before = store.session(id).revision;
    turns[0].input.onEvent({
      type: "session.providerBound",
      providerSessionId: "provider-thread",
    });
    turns[0].input.onEvent({
      type: "message.delta",
      text: "still working while disconnected",
    });
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    expect(
      store.session(id).session.blocks.some((block) => block.text.includes("still working")),
    ).toBe(true);
    expect(store.events(id, before).events?.length).toBeGreaterThan(1);
    expect(engine.command(command)).toEqual(receipt);
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(provider.bind).toHaveBeenCalledWith(id, "provider-thread", expect.any(String), undefined);
    expect(() => engine.command({ ...command, text: "Changed payload" })).toThrow(
      "different payload",
    );
  });

  it.each(["codex", "claude"] as const)(
    "keeps %s turn timing and model provenance after settlement and reconnect",
    async (harness) => {
      const { engine, store, turns, id } = setup(harness);
      engine.command({
        type: "send",
        commandId: "first-turn",
        sessionId: id,
        text: "Inspect the project",
      });
      await vi.waitFor(() => expect(turns).toHaveLength(1));
      const running = store.session(id);
      expect(running.session.blocks[0]).toMatchObject({
        id: "first-turn",
        startedAt: expect.any(Number),
        turnModel: { harness, id: `${harness}:test` },
      });
      turns[0].input.onEvent({ type: "message.delta", text: "Found it" });
      turns[0].finish();
      await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));

      const reconnected = store.sync(id);
      expect(reconnected.kind).toBe("snapshot");
      if (reconnected.kind !== "snapshot") return;
      expect(reconnected.value.session.blocks[0]).toMatchObject({
        id: "first-turn",
        startedAt: expect.any(Number),
        durationMs: expect.any(Number),
        turnModel: { harness, id: `${harness}:test` },
      });
      expect(reconnected.value.session.blocks[0].durationMs).toBeGreaterThanOrEqual(0);
      expect(reconnected.value.session.blocks[1].text).toBe("Found it");

      const delta = store.sync(id, running.revision);
      expect(delta.kind).toBe("delta");
      if (delta.kind === "delta")
        expect(
          delta.blocks.some((block) => block.id === "first-turn" && block.durationMs != null),
        ).toBe(true);
    },
  );

  it("serializes concurrent sends and accepts only one approval decision for a run", async () => {
    const { engine, store, turns, provider, id } = setup();
    engine.command({
      type: "send",
      commandId: "send",
      sessionId: id,
      text: "Work",
    });
    expect(() =>
      engine.command({
        type: "send",
        commandId: "other-send",
        sessionId: id,
        text: "More work",
      }),
    ).toThrow("already running");
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    turns[0].input.onEvent({
      type: "approval.requested",
      requestId: 7,
      title: "Run a command?",
    });
    const runId = store.session(id).runId!;
    const approval = {
      type: "approve",
      commandId: "approval-1",
      sessionId: id,
      runId,
      requestId: 7,
      decision: "allow",
    };
    expect(() => engine.command({ ...approval, runId: "stale" })).toThrow("finished or replaced");
    engine.command(approval);
    engine.command(approval);
    expect(() =>
      engine.command({
        ...approval,
        commandId: "approval-2",
        decision: "deny",
      }),
    ).toThrow("already resolved");
    expect(provider.approve).toHaveBeenCalledTimes(1);
    expect(provider.approve).toHaveBeenCalledWith(id, 7, "allow");
  });

  it("stores pending questions and rejects a second device's stale answer", async () => {
    const { engine, store, turns, provider, id } = setup();
    engine.command({
      type: "send",
      commandId: "send",
      sessionId: id,
      text: "Work",
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    turns[0].input.onEvent({
      type: "question.asked",
      requestId: 3,
      questions: [
        {
          id: "q1",
          prompt: "Choose",
          multiSelect: false,
          allowCustom: false,
          options: [{ id: "yes", label: "Yes" }],
        },
      ],
    });
    const reply = {
      type: "answer",
      commandId: "answer",
      sessionId: id,
      runId: store.session(id).runId,
      requestId: 3,
      reply: { kind: "answered", answers: { q1: ["yes"] } },
    };
    engine.command(reply);
    expect(store.session(id).session.pendingQuestion).toBeUndefined();
    expect(store.session(id).session.blocks.at(-1)).toMatchObject({
      role: "user",
      text: "Choose\nYes",
    });
    const blockCount = store.session(id).session.blocks.length;
    turns[0].input.onEvent({
      type: "question.resolved",
      requestId: 3,
      decision: "answered",
      reply: { kind: "answered", answers: { q1: ["yes"] } },
    });
    expect(store.session(id).session.blocks).toHaveLength(blockCount);
    expect(() => engine.command({ ...reply, commandId: "other-answer" })).toThrow(
      "already resolved",
    );
    expect(provider.answer).toHaveBeenCalledTimes(1);
  });

  it("recovers interrupted durable state without replaying an uncertain provider send", async () => {
    const { store, provider, id } = setup();
    const value = store.session(id);
    store.transaction(() =>
      store.save(
        {
          ...value,
          revision: value.revision + 1,
          status: "running",
          runId: "old-run",
          session: {
            ...value.session,
            busy: true,
            providerSessionId: "retained",
            blocks: [
              {
                id: "interrupted-turn",
                role: "user",
                text: "Work",
                startedAt: value.updatedAt - 2_000,
              },
            ],
          },
        },
        { type: "accepted" },
      ),
    );
    const recovered = new HostEngine(store, { codex: provider });
    // Whoever drains the queue is told which turns were cut short by the restart.
    expect(recovered.recoveredInterrupted).toEqual([id]);
    expect(store.session(id).status).toBe("interrupted");
    expect(store.session(id).session.busy).toBe(false);
    expect(store.session(id).session.blocks[0].durationMs).toBe(2_000);
    expect(provider.send).not.toHaveBeenCalled();
    expect(provider.bind).toHaveBeenCalledWith(id, "retained", value.session.cwd, undefined);
    await recovered.close();
  });

  it("resumes a conversation under its provider account", async () => {
    const { engine, store, provider, turns, id } = setup("claude");
    const value = store.session(id);
    store.save(
      {
        ...value,
        revision: value.revision + 1,
        session: {
          ...value.session,
          providerSessionId: "account-thread",
          providerAccountId: "account-1",
        },
      },
      { type: "test.seed" },
    );
    engine.command({ type: "send", commandId: "send", sessionId: id, text: "Continue" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(provider.bind).toHaveBeenLastCalledWith(
      id,
      "account-thread",
      value.session.cwd,
      "account-1",
    );
    expect(turns[0].input.providerAccountId).toBe("account-1");
    turns[0].finish();
  });

  it("retries a failed event write and settles the stopped turn", async () => {
    const { engine, store, turns, id } = setup();
    engine.command({
      type: "send",
      commandId: "send",
      sessionId: id,
      text: "Work",
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    const original = store.save.bind(store);
    let failed = false;
    vi.spyOn(store, "save").mockImplementation((value, event) => {
      if (!failed && (event as { type?: string }).type === "events") {
        failed = true;
        throw new Error("temporary storage error");
      }
      return original(value, event);
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      turns[0].input.onEvent({
        type: "message.delta",
        text: "Retained output",
      });
      turns[0].finish();
      await vi.waitFor(() => expect(store.session(id).status).toBe("interrupted"), {
        timeout: 4_000,
      });
      expect(
        store.session(id).session.blocks.some((block) => block.text === "Retained output"),
      ).toBe(true);
      expect(store.session(id).session.busy).toBe(false);
    } finally {
      log.mockRestore();
    }
  });

  it("retries a failed final settlement", async () => {
    const { engine, store, turns, id } = setup();
    const ended: Array<{ cancelled?: boolean; error?: string; interrupted?: boolean; reason?: string }> = [];
    engine.onSettled = (_id, outcome) => void ended.push(outcome);
    engine.command({
      type: "send",
      commandId: "send",
      sessionId: id,
      text: "Work",
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    const original = store.save.bind(store);
    let failed = false;
    vi.spyOn(store, "save").mockImplementation((value, event) => {
      if (!failed && (event as { type?: string }).type === "settled") {
        failed = true;
        throw new Error("temporary storage error");
      }
      return original(value, event);
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      turns[0].finish();
      await vi.waitFor(() => expect(store.session(id).status).toBe("interrupted"), {
        timeout: 4_000,
      });
      expect(store.session(id).session.busy).toBe(false);
      // The retry path tells the queue's drainer the turn was cut short, like the normal one.
      expect(ended).toEqual([
        expect.objectContaining({ interrupted: true, reason: expect.stringContaining("storage failed") }),
      ]);
    } finally {
      log.mockRestore();
    }
  });

  it("batches streamed output and syncs only changed blocks", async () => {
    const { engine, store, turns, id, project } = setup();
    engine.command({
      type: "send",
      commandId: "send",
      sessionId: id,
      text: "Work",
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    const started = store.session(id).revision;
    for (let index = 0; index < 50; index++)
      turns[0].input.onEvent({
        type: "message.delta",
        text: `chunk ${index} `,
      });
    expect(store.session(id).revision).toBe(started);
    await vi.waitFor(() => expect(store.session(id).revision).toBe(started + 1));
    const sync = store.sync(id, started);
    expect(sync.kind).toBe("delta");
    if (sync.kind !== "delta") return;
    expect(sync.blocks.map((block) => block.role)).toEqual(["assistant"]);
    expect(sync.blockIds).toHaveLength(2);

    turns[0].input.onEvent({
      type: "approval.requested",
      requestId: 1,
      title: "Run a command?",
    });
    expect(store.session(id).revision).toBe(started + 2);

    const streamed = store.session(id).revision;
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    const settled = store.sync(id, streamed);
    if (settled.kind !== "delta") throw new Error("Expected a delta");
    expect(settled.blocks.some((block) => block.role === "user" && block.durationMs != null)).toBe(
      true,
    );
    expect(store.sync(id, store.session(id).revision).kind).toBe("unchanged");
    expect(store.sync(id).kind).toBe("snapshot");
    expect(store.summaries(project.id)[0]).toMatchObject({
      id,
      status: "idle",
      title: "codex · Work",
    });
  });

  it("catches a client up from a stale copy even after the host trimmed its event log", async () => {
    const { engine, store, turns, id } = setup();
    engine.command({
      type: "send",
      commandId: "work",
      sessionId: id,
      text: "Work",
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    const stale = store.session(id);
    // The app went away here; the turn keeps producing output meanwhile.
    for (let step = 0; step < 3; step++) {
      turns[0].input.onEvent({
        type: "approval.requested",
        requestId: step + 1,
        title: `Run ${step}?`,
      });
    }
    turns[0].input.onEvent({
      type: "message.delta",
      text: "finished the work",
    });
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    const current = store.session(id);
    expect(current.revision).toBeGreaterThan(stale.revision + 1);

    // The retained events no longer reach back to the client's revision.
    store.db
      .prepare("DELETE FROM events WHERE session_id=? AND revision<=?")
      .run(id, stale.revision + 1);
    expect(store.events(id, stale.revision).snapshot?.revision).toBe(current.revision);

    // The app does not read events: its sync is by block revision, so the
    // stale copy still becomes the host's state, in order and without repeats.
    const sync = store.sync(id, stale.revision);
    expect(sync.kind).toBe("delta");
    const caughtUp = applySessionSync(stale, sync);
    expect(caughtUp.session.blocks.map((block) => block.id)).toEqual(
      current.session.blocks.map((block) => block.id),
    );
    expect(caughtUp.session.blocks).toEqual(current.session.blocks);
    expect(caughtUp.status).toBe("idle");

    // A client ahead of the host (restored or replaced host) reloads in full.
    expect(store.sync(id, current.revision + 10).kind).toBe("snapshot");
  });

  it("requires snapshot recovery when the client's event cursor is invalid", () => {
    const { store, id } = setup();
    expect(store.events(id, 100_000).snapshot?.session.id).toBe(id);
  });

  it("arms a remote usage limit only from the desktop's setting", async () => {
    const { engine, store, turns, id } = setup();
    const limit = async (commandId: string, resumeAtReset?: boolean) => {
      engine.command({
        type: "send",
        commandId,
        sessionId: id,
        text: "Work",
        ...(resumeAtReset === undefined ? {} : { resumeAtReset }),
      });
      await vi.waitFor(() => expect(turns.at(-1)?.input.text).toBe("Work"));
      const turn = turns.pop()!;
      turn.input.onEvent({ type: "usage.limited", resetsAt: 5_000 });
      turn.finish();
      await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
      return store.session(id).session.usageLimit;
    };
    expect(await limit("off", false)).toEqual({
      resetsAt: 5_000,
      resumeAtReset: false,
    });
    expect(await limit("on", true)).toEqual({
      resetsAt: 5_000,
      resumeAtReset: true,
    });
    // An older desktop never sends the setting; it must not auto-resume.
    expect(await limit("older", undefined)).toEqual({
      resetsAt: 5_000,
      resumeAtReset: false,
    });
  });

  it("cancels, re-arms, and dismisses a remote usage limit", async () => {
    const { engine, store, turns, id } = setup();
    engine.command({
      type: "send",
      commandId: "limited",
      sessionId: id,
      text: "Work",
      resumeAtReset: true,
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    turns[0].input.onEvent({ type: "usage.limited", resetsAt: 5_000 });
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));

    engine.command({
      type: "usageLimit",
      commandId: "cancel",
      sessionId: id,
      action: "disarm",
    });
    expect(store.session(id).session.usageLimit).toEqual({
      resetsAt: 5_000,
      resumeAtReset: false,
    });
    engine.command({
      type: "usageLimit",
      commandId: "arm",
      sessionId: id,
      action: "arm",
    });
    expect(store.session(id).session.usageLimit).toEqual({
      resetsAt: 5_000,
      resumeAtReset: true,
    });
    engine.command({
      type: "usageLimit",
      commandId: "dismiss",
      sessionId: id,
      action: "dismiss",
    });
    expect(store.session(id).session.usageLimit).toBeUndefined();
  });

  it("clears the usage limit once the host accepts the next turn", async () => {
    const { engine, store, turns, id } = setup();
    engine.command({
      type: "send",
      commandId: "limited",
      sessionId: id,
      text: "Work",
      resumeAtReset: true,
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    turns[0].input.onEvent({ type: "usage.limited", resetsAt: 5_000 });
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    expect(store.session(id).session.usageLimit?.resumeAtReset).toBe(true);

    engine.command({
      type: "send",
      commandId: "continue",
      sessionId: id,
      text: "Continue",
      resumeAtReset: true,
    });
    // Left in place, the armed limit would resume this session again after
    // the continue turn ends.
    expect(store.session(id).session.usageLimit).toBeUndefined();
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    turns[1].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    expect(store.session(id).session.usageLimit).toBeUndefined();
  });

  it("validates untrusted commands before execution", () => {
    expect(() =>
      parseCommand({ type: "send", commandId: "x", sessionId: "y", text: "" }),
    ).toThrow();
    expect(() =>
      parseCommand({
        type: "create",
        commandId: "x",
        projectId: "y",
        harness: "shell",
        model: "x",
        runtimeMode: "auto",
      }),
    ).toThrow();
    expect(() =>
      parseCommand({
        type: "answer",
        commandId: "x",
        sessionId: "y",
        runId: "z",
        requestId: 1,
        reply: { kind: "answered", answers: { a: [42] } },
      }),
    ).toThrow();
    expect(() =>
      parseCommand({
        type: "usageLimit",
        commandId: "x",
        sessionId: "y",
        action: "resume",
      }),
    ).toThrow();
    expect(() =>
      parseCommand({
        type: "send",
        commandId: "x",
        sessionId: "y",
        text: "Work",
        resumeAtReset: "yes",
      }),
    ).toThrow();
  });
});
