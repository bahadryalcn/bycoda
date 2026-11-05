import { runTextOperation } from "../src/integrations/harness/core/textSource";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import { withMachineSkillPolicy, type HostProvider } from "./providers/providers";
import { HostEngine, parseCommand, type ManagedTurnHistoryAdapter } from "./engine";
import type { TurnGitRecord, TurnGitSnapshot } from "./workspaces/workspace-contracts";
import { HostStore } from "./store";

it.each(["success", "known-empty", "missing", "pending", "failed", "wrong-token", "reused-token", "late"] as const)(
  "keeps automatic utility ownership truthful for %s without manual Title commands",
  async (outcome) => {
    const { engine, store, id, provider } = await setup();
    const value = await store.session(id);
    type Context = NonNullable<SendTurnInput["operationContext"]>;
    const internal = engine as unknown as {
      backgroundProviderWork(input: typeof value, provider: HostProvider, effect: (context: Context) => Promise<null>, apply: (result: null) => Promise<void>): void;
      activityProviders: Map<{ bookkeepingWork: Promise<unknown> }, unknown>;
      retainedProviders: Map<string, Set<HostProvider>>;
    };
    let late: (() => void) | undefined;
    internal.backgroundProviderWork(value, provider, async (context) => {
      if (outcome === "success" || outcome === "known-empty")
        await runTextOperation(context, async () => null);
      else if (outcome !== "missing") {
        const token = {};
        context.onUtilityStarted?.(token);
        if (outcome === "failed") context.onUtilityFailed?.(token);
        else if (outcome === "wrong-token") context.onUtilityCompleted?.({});
        else if (outcome === "reused-token") {
          context.onUtilityCompleted?.(token);
          context.onUtilityStarted?.(token);
          context.onUtilityCompleted?.(token);
        } else if (outcome === "late") late = () => context.onUtilityCompleted?.(token);
      }
      return null;
    }, async () => {});
    const activity = [...internal.activityProviders.keys()][0];
    await activity.bookkeepingWork;
    late?.();
    const remove = vi.fn(async () => store.deleteSession(id));
    if (outcome === "success" || outcome === "known-empty") {
      expect(internal.retainedProviders.has(id)).toBe(false);
      await engine.withRetiredProviderWriterForDeletion(id, remove, async () => {});
      expect(remove).toHaveBeenCalledOnce();
    } else {
      expect(internal.retainedProviders.get(id)?.has(provider)).toBe(true);
      await expect(engine.withRetiredProviderWriterForDeletion(id, remove, async () => {})).rejects.toThrow("Other original provider work remains");
      expect(remove).not.toHaveBeenCalled();
    }
  },
);

it("checks original authority after asynchronous skill preparation before provider entry", async () => {
  const { engine, store, id, provider, turns } = await setup();
  let entered!: () => void, release!: () => void;
  const preparing = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  provider.prepareOperationPolicy = async (input) => {
    entered();
    await gate;
    return input;
  };
  const receipt = await engine.command({ type: "send", commandId: "async-skill-authority", sessionId: id, text: "Continue" });
  await preparing;
  const authority = vi.spyOn(store, "assertAuthority").mockRejectedValueOnce(new Error("Original authority replaced"));
  release();
  try {
    await engine.waitForRun(id, receipt.runId);
    expect(authority).toHaveBeenCalled();
    expect(turns).toHaveLength(0);
    expect(provider.send).not.toHaveBeenCalled();
  } finally {
    authority.mockRestore();
  }
});

it.each(["configure", "draft"] as const)("rejects stale %s revisions atomically and reuses an accepted receipt", async (type) => {
  const { engine, store, id } = await setup();
  const initial = await store.session(id);
  const command = {
    type, commandId: `revision-${type}`, sessionId: id, expectedRevision: initial.revision,
    ...(type === "configure" ? { model: "codex:updated", modelSettings: {}, runtimeMode: "supervised" } : { text: "unsent draft" }),
  };
  await engine.updateSession(id, { title: "Changed by owner" });
  await expect(engine.command(command)).rejects.toThrow("conversation changed");
  const current = await store.session(id);
  expect(current.session.model).toBe(initial.session.model);
  expect(current.session.blocks).toEqual(initial.session.blocks);
  const accepted = { ...command, commandId: `accepted-${type}`, expectedRevision: current.revision };
  const receipt = await engine.command(accepted);
  expect(await engine.command(accepted)).toEqual(receipt);
  expect((await store.session(id)).revision).toBe(receipt.revision);
});
import { launchSessionRun } from "./sessions/sessionRuns";
import { readAttachmentChunk, writeAttachmentChunk } from "./attachments/attachments";
import {
  applySessionSync,
  REMOTE_PROVIDERS,
  type RemoteProvider,
} from "../src/features/connections/model/protocol";
import { sessionIssue } from "../src/features/sessions/model/sessionIssue";
import { deriveActivityDock } from "../src/features/sessions/model/activityDock";
import { isActivityBlock, isNoticeBlock } from "../src/features/sessions/model/transcriptActivity";
import { conversationHead } from "../src/features/sync/model/conversationDigest";
import { mergeAdoptedSession } from "../src/features/connections/model/adoptedSessions";
import { appendReadyHandoff } from "../src/features/sessions/model/handoff";
import { setHarnessModels, resetHarnessModelOverlays } from "../src/features/sessions/model/models";
import * as runtimeGuidance from "../src/integrations/harness/core/runtimeGuidance";
import { HandoffHistoryStore } from "./tasks/handoff-history";
import * as skillPrompts from "./skills/prompt-skills";
import { withChatCitations } from "../src/features/sessions/model/chatCitation";
import { execFileAsync } from "../src/shared/lib/processExecution.node";

const cleanups: Array<() => Promise<void> | void> = [];
it("regenerates only title metadata using the selected utility model and replays its receipt", async () => {
  const { engine, store, id, provider, turns } = await setup();
  const original = await store.session(id);
  await store.save({ ...original, revision: original.revision + 1, session: { ...original.session, blocks: [{ id: "message", role: "user", text: "Fix title generation" }] } }, { type: "test.seed" });
  provider.generateTitle = vi.fn(async () => ({ title: "Reliable title generation", workItem: null }));
  const command = { type: "regenerateTitle", commandId: "regenerate-1", sessionId: id, expectedTitle: original.session.title, harness: "codex", model: "codex:terra", modelSettings: { effort: "low" } };
  const receipt = await engine.command(command);
  expect(await engine.command(command)).toEqual(receipt);
  expect(provider.generateTitle).toHaveBeenCalledOnce();
  expect(provider.generateTitle).toHaveBeenCalledWith(expect.objectContaining({ model: "codex:terra", modelSettings: { effort: "low" }, message: "user: Fix title generation" }));
  const saved = await store.session(id);
  expect(saved.session.title).toContain("Reliable title generation");
  expect(saved.session.model).toBe(original.session.model);
  expect(saved.session.blocks).toHaveLength(1);
  expect(turns).toHaveLength(0);
});

it("rejects stale title regeneration without invoking the provider", async () => {
  const { engine, id, provider } = await setup();
  provider.generateTitle = vi.fn(async () => ({ title: "Other", workItem: null }));
  await expect(engine.command({ type: "regenerateTitle", commandId: "stale-title", sessionId: id, expectedTitle: "Earlier title", harness: "codex", model: "codex:terra" })).rejects.toThrow("Conversation title changed");
  expect(provider.generateTitle).not.toHaveBeenCalled();
});
it("projects citation-only prompts at the Host provider boundary while preserving raw history", async () => {
  const { engine, store, id, turns, waitForTurnStart } = await setup();
  const text = withChatCitations("Explain this passage.", [
    {
      version: 1,
      id: "citation-1",
      sessionId: id,
      blockId: "old-reply",
      text: "A selected phrase",
      sourceText: "A selected phrase",
      occurrence: 0,
      comment: "Keep it compact",
    },
  ]);
  const receipt = await engine.command({
    type: "send",
    commandId: "citation-prompt",
    sessionId: id,
    text,
  });
  await waitForTurnStart();
  expect(turns[0].input.text).not.toContain("bycoda-citation:");
  expect(turns[0].input.text).toContain('"quote": "A selected phrase"');
  expect(turns[0].input.text).toContain('"comment": "Keep it compact"');
  expect(
    (await store.session(id)).session.blocks.find((block) => block.id === "citation-prompt")?.text,
  ).toBe(text);
  turns[0].finish();
  await engine.waitForRun(id, receipt.runId);
});
it("stamps internal message authors without accepting a client author or leaking to the owner turn", async () => {
  const { engine, store, id, turns, waitForTurnStart } = await setup();
  const author = {
    kind: "assistant" as const,
    name: "Arif",
    jobId: "job-1",
    reason: "nudge" as const,
    operationId: "op-1",
  };
  const input = {
    type: "send" as const,
    commandId: "stamped-message",
    sessionId: id,
    text: "Continue the assigned task.",
  };
  const receipt = await engine.withMessageAuthor(author, () => engine.command(input));
  await waitForTurnStart();
  expect(
    (await store.session(id)).session.blocks.find((block) => block.id === input.commandId)?.author,
  ).toEqual(author);
  turns[0].finish();
  await engine.waitForRun(id, receipt.runId);
  const forged = await engine.command({ ...input, commandId: "forged", author } as Parameters<
    HostEngine["command"]
  >[0]);
  await waitForTurnStart(2);
  expect(
    (await store.session(id)).session.blocks.find((block) => block.id === "forged")?.author,
  ).toBeUndefined();
  turns[1].finish();
  await engine.waitForRun(id, forged.runId);
  const owner = await engine.command({
    ...input,
    commandId: "owner-message",
    text: "Owner follow-up",
  });
  await waitForTurnStart(3);
  expect(
    (await store.session(id)).session.blocks.find((block) => block.id === "owner-message")?.author,
  ).toBeUndefined();
  turns[2].finish();
  await engine.waitForRun(id, owner.runId);
});

it("validates and persists the explicitly selected profile before sending a new host session", async () => {
  const { engine, store, project, turns, waitForTurnStart } = await setup();
  const command = {
    type: "create",
    commandId: "named-profile",
    projectId: project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
    providerAccountId: "account-work",
  };
  const created = await engine.command(command);
  expect((await store.session(created.sessionId)).session.providerAccountId).toBe("account-work");
  await engine.command({
    type: "send",
    commandId: "send-named",
    sessionId: created.sessionId,
    text: "hello",
  });
  await waitForTurnStart();
  expect(turns).toHaveLength(1);
  expect(turns[0].input.providerAccountId).toBe("account-work");
  expect(() => parseCommand({ ...command, providerAccountId: "../outside" })).toThrow(
    "Invalid provider account ID",
  );
});

it("sends the reviewed note snapshot once while persisting display metadata without its body", async () => {
  const { engine, store, id, turns, provider, waitForTurnStart } = await setup();
  const noteCard = {
    id: "note-a",
    slug: "review",
    title: "Review",
    body: "Reviewed note body",
    sourceCwd: "/source",
  };
  const command = {
    type: "send",
    commandId: "note-context",
    sessionId: id,
    text: "Check this",
    noteCard,
  };
  expect(provider.send).not.toHaveBeenCalled();
  const receipt = await engine.command(command);
  expect(await engine.command(command)).toEqual(receipt);
  await waitForTurnStart();
  expect(turns).toHaveLength(1);
  expect(turns[0].input.text).toContain('Referenced note "Review":\n\nReviewed note body');
  const user = (await store.session(id)).session.blocks.find(
    (block) => block.id === command.commandId,
  )!;
  expect(user.text).toBe("Check this");
  expect(user.noteCard).toEqual({
    id: "note-a",
    slug: "review",
    title: "Review",
    sourceCwd: "/source",
  });
  expect(JSON.stringify(user)).not.toContain("Reviewed note body");
  await expect(
    engine.command({ ...command, noteCard: { ...noteCard, body: "Changed snapshot" } }),
  ).rejects.toThrow();
  turns[0].finish();
  await engine.waitForRun(id, receipt.runId);
  expect((await store.session(id)).status).toBe("idle");
  await engine.command({ ...command, commandId: "note-only", text: "" });
  await waitForTurnStart(2);
  expect(turns).toHaveLength(2);
  expect(turns[1].input.text).toContain("Use this note.");
  turns[1].finish();
});

it("rejects unsupported note context actions before changing the conversation", async () => {
  const { engine, store, id, provider } = await setup();
  const noteCard = { id: "note-a", slug: "review", title: "Review", body: "Reviewed note body" };
  const original = await store.session(id);
  const base = { type: "send", commandId: "invalid-note", sessionId: id, text: "Check", noteCard };
  for (const extra of [
    { type: "steer" },
    { type: "draft" },
    { type: "compact" },
    { intent: "plan" },
    { text: "/clear" },
    { text: "/compact" },
    { queued: {} },
    { noteCard: { ...noteCard, body: "x".repeat(64_001) } },
  ])
    await expect(engine.command({ ...base, ...extra })).rejects.toThrow();
  expect(await store.session(id)).toEqual(original);
  expect(provider.send).not.toHaveBeenCalled();
});

it("keeps a Codex goal command leading while carrying reviewed note content in runtime instructions", async () => {
  const { engine, store, id, turns, waitForTurnStart } = await setup();
  await engine.command({
    type: "send",
    commandId: "goal-note-context",
    sessionId: id,
    text: "/goal Review the changes",
    noteCard: {
      id: "note-goal",
      slug: "goal",
      title: "Review goals",
      body: "Check keyboard and focus.",
    },
  });
  await waitForTurnStart();
  expect(turns).toHaveLength(1);
  expect(turns[0].input.text).toBe("/goal Review the changes");
  expect(turns[0].input.runtimeInstructions).toContain("Check keyboard and focus.");
  expect(
    (await store.session(id)).session.blocks.find((block) => block.id === "goal-note-context")
      ?.noteCard?.title,
  ).toBe("Review goals");
  turns[0].finish();
});

it("keeps browser annotation attachments bound to their exact project and conversation", async () => {
  const { engine, store, id, project, turns, provider, waitForTurnStart } = await setup();
  const fileId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  await writeAttachmentChunk(store, {
    id: fileId,
    offset: 0,
    size: 3,
    data: Buffer.from("abc").toString("base64"),
  });
  const annotation = {
    id: "selection",
    projectId: project.id,
    sessionId: id,
    navigationId: "reviewed-navigation",
    capturedAt: "2026-10-22T00:00:00.000Z",
    pageUrl: "https://fixture.invalid",
    trust: "untrusted-page-data",
    limitations: [],
    comment: "Check this element",
    viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
    devicePixelRatio: 1,
    element: {
      tag: "button",
      text: "Page content",
      selector: "#fixture",
      path: "body > button",
      bounds: { x: 1, y: 2, width: 20, height: 30 },
      center: { x: 11, y: 17 },
      ancestry: [],
      computedStyle: {},
    },
  };
  const file = {
    id: fileId,
    name: "browser-element.jpg",
    size: 3,
    mimeType: "image/jpeg",
    kind: "image",
    browserAnnotation: annotation,
  };
  const base = {
    type: "send",
    commandId: "browser-selection",
    sessionId: id,
    text: "Review the selected element",
  };
  const original = await store.session(id);
  for (const patch of [{ projectId: "foreign-project" }, { sessionId: "foreign-session" }])
    await expect(
      engine.command({
        ...base,
        attachments: [{ ...file, browserAnnotation: { ...annotation, ...patch } }],
      }),
    ).rejects.toThrow(/another project or conversation/);
  for (const type of ["draft", "steer"])
    await expect(
      engine.command({
        ...base,
        type,
        runId: "not-running",
        attachments: [
          { ...file, browserAnnotation: { ...annotation, sessionId: "foreign-session" } },
        ],
      }),
    ).rejects.toThrow(/another project or conversation/);
  expect(await store.session(id)).toEqual(original);
  expect(provider.send).not.toHaveBeenCalled();
  await engine.command({ ...base, attachments: [file] });
  await waitForTurnStart();
  expect(turns).toHaveLength(1);
  expect(turns[0].input.attachments?.[0]?.browserAnnotation).toMatchObject({
    sessionId: id,
    projectId: project.id,
    trust: "untrusted-page-data",
    comment: "Check this element",
  });
  turns[0].finish();
});

it("clears the same host session durably and starts the next turn without the old binding", async () => {
  const { engine, store, id, provider, turns, waitForTurnStart } = await setup();
  const runReceipt = await engine.command({
    type: "send",
    commandId: "before-clear",
    sessionId: id,
    text: "Old context",
  });
  await waitForTurnStart();
  expect(turns).toHaveLength(1);
  turns[0].input.onEvent({ type: "session.providerBound", providerSessionId: "old-native" });
  turns[0].finish();
  await engine.waitForRun(id, runReceipt.runId);
  expect((await store.session(id)).status).toBe("idle");
  vi.mocked(provider.stop).mockClear();
  vi.mocked(provider.bind).mockClear();
  const command = { type: "send", commandId: "clear", sessionId: id, text: "/clear" };
  const receipt = await engine.clearConversation(command);
  expect(await engine.clearConversation(command)).toEqual(receipt);
  expect(provider.stop).toHaveBeenCalledOnce();
  expect((await store.session(id)).session).toMatchObject({ id, blocks: [] });
  expect((await store.session(id)).session.providerSessionId).toBeUndefined();
  expect((await store.session(id)).session.pendingContextReplay).toBeUndefined();
  expect(provider.send).toHaveBeenCalledOnce();
  await engine.command({
    type: "send",
    commandId: "after-clear",
    sessionId: id,
    text: "New context",
  });
  await waitForTurnStart(2);
  expect(turns).toHaveLength(2);
  expect(turns[1].input.text).toBe("New context");
  expect(provider.bind).not.toHaveBeenCalled();
});

it("rejects clearing a running host session", async () => {
  const { engine, id, provider, turns, waitForTurnStart } = await setup();
  await engine.command({ type: "send", commandId: "running", sessionId: id, text: "Keep working" });
  await waitForTurnStart();
  expect(turns).toHaveLength(1);
  await expect(
    engine.clearConversation({
      type: "send",
      commandId: "clear-busy",
      sessionId: id,
      text: "/clear",
    }),
  ).rejects.toThrow("Stop the current turn");
  expect(provider.stop).not.toHaveBeenCalled();
});

it("surfaces provider startup rejection as a failed turn outside folded activity", async () => {
  const { engine, store, id, provider } = await setup();
  provider.send = vi.fn(async () => {
    throw new Error("thread test already has an active writer");
  });
  await engine.command({
    type: "send",
    commandId: "writer-conflict",
    sessionId: id,
    text: "Continue",
  });
  await vi.waitFor(async () =>
    expect((await store.session(id)).session.blocks.at(-1)?.notice).toBe("error"),
  );
  const session = (await store.session(id)).session;
  expect(sessionIssue(session)).toBe("failed");
  expect(isNoticeBlock(session.blocks.at(-1)!)).toBe(true);
  expect(isActivityBlock(session.blocks.at(-1)!)).toBe(false);
  expect(session.blocks.at(-1)?.text).toContain("active writer");
});

it("tells who is waiting on a turn how it ended, and why a conversation cannot start one", async () => {
  const { engine, store, id, provider, turns, waitForTurnStart } = await setup();
  const ended: Array<{ cancelled?: boolean; error?: string; interrupted?: boolean }> = [];
  engine.onSettled = (_id, outcome) => void ended.push(outcome);
  expect(await engine.busyReason(id)).toBeUndefined();
  // A turn that ends well.
  const first = await engine.command({
    type: "send",
    commandId: "ok-1",
    sessionId: id,
    text: "one",
  });
  await waitForTurnStart();
  expect(turns).toHaveLength(1);
  turns[0].finish();
  await engine.waitForRun(id, first.runId);
  expect(ended).toHaveLength(1);
  expect(ended[0]).toEqual({});
  // A turn the user stopped is not a failure, whatever the provider says.
  const second = await engine.command({
    type: "send",
    commandId: "ok-2",
    sessionId: id,
    text: "two",
  });
  await waitForTurnStart(2);
  expect(turns).toHaveLength(2);
  await engine.command({
    type: "cancel",
    commandId: "stop-2",
    sessionId: id,
    runId: (await store.session(id)).runId!,
  });
  await engine.waitForRun(id, second.runId);
  expect(ended).toHaveLength(2);
  expect(ended[1]).toEqual({ cancelled: true });
  // A provider that fails carries its message.
  let failedStarted!: () => void;
  const failureStarted = new Promise<void>((resolve) => {
    failedStarted = resolve;
  });
  provider.send = vi.fn(async () => {
    failedStarted();
    throw new Error("provider exploded");
  });
  const third = await engine.command({
    type: "send",
    commandId: "ok-3",
    sessionId: id,
    text: "three",
  });
  await failureStarted;
  await engine.waitForRun(id, third.runId);
  expect(ended).toHaveLength(3);
  expect(ended[2]).toEqual({ error: "provider exploded" });
  // The host going down is told apart too.
  const stopping = engine.close();
  expect(await engine.busyReason(id)).toBe("Host is stopping");
  await stopping;
});

it("attributes only successful edit tool paths to the active checkpoint turn", async () => {
  const { engine, store, id, turns, waitForTurnStart } = await setup();
  const claim = vi.spyOn(engine.checkpoints, "claim").mockResolvedValue(undefined);
  const receipt = await engine.command({
    type: "send",
    commandId: "checkpoint-tools",
    sessionId: id,
    text: "Edit files",
  });
  await waitForTurnStart();
  expect(turns).toHaveLength(1);
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
  expect(claim).toHaveBeenCalledWith(
    id,
    (await store.session(id)).session.cwd,
    (await store.session(id)).runId,
    ["new.txt"],
  );
  turns[0].finish();
  await engine.waitForRun(id, receipt.runId);
  expect((await store.session(id)).status).toBe("idle");
});

it("steers the active host turn without replacing it, and deduplicates retries", async () => {
  const { engine, store, id, provider, turns, waitForTurnStart } = await setup();
  provider.steer = vi.fn(async () => {});
  await engine.command({ type: "send", commandId: "start", sessionId: id, text: "first" });
  await waitForTurnStart();
  expect(turns).toHaveLength(1);
  const runId = (await store.session(id)).runId!;
  turns[0].input.onAccepted?.();
  const command = { type: "steer", commandId: "redirect", sessionId: id, runId, text: "second" };
  const receipt = await engine.command(command);
  expect(await engine.command(command)).toEqual(receipt);
  await vi.waitFor(() => expect(provider.steer).toHaveBeenCalledOnce());
  await vi.waitFor(async () =>
    expect(
      (await store.session(id)).session.blocks.find((block) => block.id === "redirect")?.draft,
    ).toBeUndefined(),
  );
  expect(provider.send).toHaveBeenCalledOnce();
  expect((await store.session(id)).runId).toBe(runId);
  expect(
    (await store.session(id)).session.blocks.filter((block) => block.id === "redirect"),
  ).toHaveLength(1);
  await expect(engine.command({ ...command, commandId: "stale", runId: "old" })).rejects.toThrow();
});

it.each(["reasoning", "subagent", "background command"] as const)(
  "keeps host steering messages attached to the execution owner during %s",
  async (activity) => {
    const { engine, store, id, provider, turns, waitForTurnStart } = await setup();
    provider.steer = vi.fn(async () => {});
    const receipt = await engine.command({
      type: "send",
      commandId: "execution-owner",
      sessionId: id,
      text: "Work",
    });
    await waitForTurnStart();
    turns[0].input.onAccepted?.();
    turns[0].input.onEvent({ type: "reasoning.delta", text: "Planning the work" });
    if (activity !== "reasoning") {
      turns[0].input.onEvent({
        type: "tool.started",
        callId: "ongoing-work",
        title: activity === "subagent" ? "Research" : "dev server",
        kind: activity === "subagent" ? "agent" : "execute",
        status: "in_progress",
        ...(activity === "background command" ? { background: true } : {}),
      });
    }
    for (const [index, commandId] of ["first-steer", "second-steer"].entries()) {
      await engine.command({
        type: "steer",
        commandId,
        sessionId: id,
        runId: receipt.runId!,
        text: "Also check this",
      });
      await vi.waitFor(() => expect(provider.steer).toHaveBeenCalledTimes(index + 1));
      const current = await store.session(id);
      expect(current.session.blocks.find((block) => block.id === commandId)).toMatchObject({
        continuationOf: "execution-owner",
      });
      expect(current.runId).toBe(receipt.runId);
    }
    expect(provider.send).toHaveBeenCalledOnce();
    expect(provider.cancel).not.toHaveBeenCalled();
    expect(provider.stop).not.toHaveBeenCalled();
    turns[0].finish();
    await engine.waitForRun(id, receipt.runId);
  },
);

describe("child-only host run lifetime", () => {
  async function startChildOnlyRun() {
    const context = await setup();
    const { engine, id, turns, store, waitForTurnStart } = context;
    const receipt = await engine.command({
      type: "send",
      commandId: "child-owner",
      sessionId: id,
      text: "Research and run the checks",
    });
    await waitForTurnStart();
    const { input } = turns[0];
    input.onAccepted?.();
    input.onEvent({ type: "reasoning.delta", text: "Delegate the research" });
    input.onEvent({
      type: "tool.started",
      callId: "research",
      title: "Product research",
      kind: "agent",
      status: "in_progress",
    });
    input.onEvent({
      type: "tool.started",
      callId: "checks",
      title: "Run checks",
      kind: "execute",
      status: "in_progress",
      background: true,
    });
    input.onEvent({ type: "message.delta", text: "The delegated work is still running." });
    input.onEvent({ type: "message.completed" });
    input.onEvent({ type: "reasoning.completed" });
    input.onEvent({
      type: "background.updated",
      tasks: ["Product research", "Run checks"],
      agents: 1,
    });
    await vi.waitFor(async () =>
      expect((await store.session(id)).session.backgroundAgents).toBe(1),
    );
    return { ...context, receipt };
  }

  it("keeps a child-only run busy and steerable until every child and the provider finish", async () => {
    const { engine, store, id, provider, turns, receipt, waitForTurnStart } =
      await startChildOnlyRun();
    provider.steer = vi.fn(async () => {});
    const dock = async () => {
      const { session } = await store.session(id);
      return deriveActivityDock({
        blocks: session.blocks,
        busy: session.busy,
        backgroundTasks: session.backgroundTasks,
        backgroundAgents: session.backgroundAgents,
        pendingQuestion: false,
        unseenDone: false,
      });
    };
    let current = await store.session(id);
    expect(current).toMatchObject({
      status: "running",
      runId: receipt.runId,
      session: { busy: true },
    });
    expect(current.session.blocks.find((block) => block.role === "assistant")?.streaming).toBe(
      false,
    );
    expect(await dock()).toMatchObject({ state: "waiting", running: 2, backgroundAgents: 1 });
    await expect(
      engine.command({
        type: "send",
        commandId: "premature-next",
        sessionId: id,
        text: "Next request",
      }),
    ).rejects.toThrow("already running");
    await engine.command({
      type: "steer",
      commandId: "child-followup",
      sessionId: id,
      runId: receipt.runId!,
      text: "Also check the API",
    });
    await vi.waitFor(() => expect(provider.steer).toHaveBeenCalledOnce());
    current = await store.session(id);
    expect(current).toMatchObject({
      status: "running",
      runId: receipt.runId,
      session: { busy: true },
    });
    expect(current.session.blocks.find((block) => block.id === "child-followup")).toMatchObject({
      continuationOf: "child-owner",
    });
    expect(await dock()).toMatchObject({ state: "waiting", running: 2 });
    expect(provider.send).toHaveBeenCalledOnce();
    expect(provider.stop).not.toHaveBeenCalled();

    turns[0].input.onEvent({ type: "tool.updated", callId: "research", status: "completed" });
    turns[0].input.onEvent({ type: "background.updated", tasks: ["Run checks"], agents: 0 });
    await vi.waitFor(async () =>
      expect(await dock()).toMatchObject({ state: "background", running: 1, finished: 1 }),
    );
    expect((await store.session(id)).status).toBe("running");
    turns[0].input.onEvent({ type: "tool.updated", callId: "checks", status: "completed" });
    turns[0].input.onEvent({ type: "background.updated", tasks: [], agents: 0 });
    await vi.waitFor(async () =>
      expect((await store.session(id)).session.backgroundTasks).toBeUndefined(),
    );
    expect((await store.session(id)).session.busy).toBe(true);
    expect(provider.stop).not.toHaveBeenCalled();
    turns[0].finish();
    await engine.waitForRun(id, receipt.runId);
    expect(await store.session(id)).toMatchObject({ status: "idle", session: { busy: false } });
    expect(await dock()).toMatchObject({ state: "idle", running: 0, finished: 2 });
    // A successful current-checkout run retains its warm provider after all work settles.
    expect(provider.stop).not.toHaveBeenCalled();
    const next = await engine.command({
      type: "send",
      commandId: "after-children",
      sessionId: id,
      text: "Next request",
    });
    await waitForTurnStart(2);
    expect(provider.send).toHaveBeenCalledTimes(2);
    turns[1].finish();
    await engine.waitForRun(id, next.runId);
  });

  it("keeps Stop effective after parent prose finishes while child work remains", async () => {
    const { engine, store, id, provider, receipt } = await startChildOnlyRun();
    expect(provider.cancel).not.toHaveBeenCalled();
    await engine.command({
      type: "cancel",
      commandId: "stop-children",
      sessionId: id,
      runId: receipt.runId!,
    });
    await engine.waitForRun(id, receipt.runId);
    const current = await store.session(id);
    expect(provider.cancel).toHaveBeenCalledOnce();
    expect(provider.send).toHaveBeenCalledOnce();
    expect(current).toMatchObject({ status: "idle", session: { busy: false } });
    expect(current.session.backgroundTasks).toBeUndefined();
    expect(current.session.blocks.find((block) => block.id === "child-owner")?.turnOutcome).toBe(
      "stopped",
    );
  });
});

describe("assistant command delivery evidence", () => {
  it("keeps a persisted command receipt unknown until provider acceptance", async () => {
    const { engine, store, id, turns, provider, waitForTurnStart } = await setup();
    const command = { type: "send", commandId: "delivery-persisted", sessionId: id, text: "Work" };
    const receipt = await engine.command(command);
    await waitForTurnStart();
    expect(await store.receiptStatus(command.commandId)).toMatchObject({ runId: receipt.runId });
    const controller = new AbortController();
    const waiting = vi.spyOn(store.changes, "wait");
    let outcome: string | undefined;
    const delivery = engine
      .commandDelivery(id, receipt.runId, command.commandId, false, controller.signal)
      .then((value) => {
        outcome = value;
        return value;
      });
    try {
      await vi.waitFor(() => expect(waiting).toHaveBeenCalled());
      expect(outcome).toBeUndefined();
      controller.abort();
      expect(await delivery).toBe("unknown");
      expect(await engine.command(command)).toEqual(receipt);
      expect(provider.send).toHaveBeenCalledOnce();
    } finally {
      controller.abort();
      waiting.mockRestore();
      turns[0].finish();
      await engine.waitForRun(id, receipt.runId);
    }
  });

  it("wakes a pending delivery wait on provider acceptance without waiting for output", async () => {
    const { engine, store, id, turns, waitForTurnStart } = await setup();
    const receipt = await engine.command({
      type: "send",
      commandId: "delivery-accepted",
      sessionId: id,
      text: "Work",
    });
    await waitForTurnStart();
    const controller = new AbortController();
    const waiting = vi.spyOn(store.changes, "wait");
    let outcome: string | undefined;
    const delivery = engine
      .commandDelivery(id, receipt.runId, "delivery-accepted", false, controller.signal)
      .then((value) => {
        outcome = value;
        return value;
      });
    try {
      await vi.waitFor(() => expect(waiting).toHaveBeenCalled());
      turns[0].input.onAccepted?.();
      await vi.waitFor(() => expect(outcome).toBe("delivered"), { timeout: 1000 });
      expect(await delivery).toBe("delivered");
      expect((await store.session(id)).status).toBe("running");
    } finally {
      controller.abort();
      await delivery;
      waiting.mockRestore();
      turns[0].finish();
      await engine.waitForRun(id, receipt.runId);
    }
  });

  it("does not call a provider startup failure delivered merely because its receipt exists", async () => {
    const { engine, store, id, provider } = await setup();
    provider.send = vi.fn(async () => {
      throw new Error("Startup rejected before acceptance");
    });
    const command = {
      type: "send",
      commandId: "delivery-startup-error",
      sessionId: id,
      text: "Work",
    };
    const receipt = await engine.command(command);
    await engine.waitForRun(id, receipt.runId);
    expect(await store.receiptStatus(command.commandId)).toMatchObject({ runId: receipt.runId });
    expect(
      await engine.commandDelivery(
        id,
        receipt.runId,
        command.commandId,
        false,
        new AbortController().signal,
      ),
    ).toBe("unknown");
    expect(await engine.command(command)).toEqual(receipt);
    expect(provider.send).toHaveBeenCalledOnce();
  });

  it("waits for delayed steer acknowledgement rather than treating in-flight delivery as settled uncertainty", async () => {
    const { engine, store, id, provider, turns, waitForTurnStart } = await setup();
    let acceptSteer!: () => void;
    provider.steer = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          acceptSteer = resolve;
        }),
    );
    const receipt = await engine.command({
      type: "send",
      commandId: "delivery-steer-primary",
      sessionId: id,
      text: "Work",
    });
    await waitForTurnStart();
    turns[0].input.onAccepted?.();
    const command = {
      type: "steer",
      commandId: "delivery-delayed-steer",
      sessionId: id,
      runId: receipt.runId,
      text: "Refine the work",
    };
    await engine.command(command);
    await vi.waitFor(() => expect(provider.steer).toHaveBeenCalledOnce());
    const controller = new AbortController();
    let outcome: string | undefined;
    const delivery = engine
      .commandDelivery(id, receipt.runId, command.commandId, true, controller.signal)
      .then((value) => {
        outcome = value;
        return value;
      });
    try {
      // Drain currently queued reads without resolving the fake provider acknowledgement.
      await store.session(id);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(outcome).toBeUndefined();
      acceptSteer();
      await vi.waitFor(() => expect(outcome).toBe("delivered"), { timeout: 1000 });
      expect(await delivery).toBe("delivered");
      expect(
        (await store.session(id)).session.blocks.find((block) => block.id === command.commandId)
          ?.followUpDelivery,
      ).toBeUndefined();
    } finally {
      controller.abort();
      acceptSteer();
      await delivery;
      turns[0].finish();
      await engine.waitForRun(id, receipt.runId);
    }
  });
});

it("stops only the exact delegated task of the active host run and deduplicates receipt replay", async () => {
  const { engine, store, id, provider, turns, waitForTurnStart } = await setup("claude");
  expect(engine.supportsItemStop("claude")).toBe(false);
  provider.stopItem = vi.fn(async () => {});
  expect(engine.supportsItemStop("claude")).toBe(true);
  const runReceipt = await engine.command({
    type: "send",
    commandId: "parent-start",
    sessionId: id,
    text: "Delegate review",
  });
  await waitForTurnStart();
  expect(turns).toHaveLength(1);
  turns[0].input.onAccepted?.();
  turns[0].input.onEvent({
    type: "tool.updated",
    callId: "agent-call",
    kind: "agent",
    status: "running",
    agentPrompt: "Review",
  });
  turns[0].input.onEvent({
    type: "agent.step",
    callId: "agent-call",
    stepId: "step",
    kind: "message",
    text: "Inspecting",
  });
  await vi.waitFor(async () =>
    expect(
      (await store.session(id)).session.blocks.some(
        (entry) => entry.agentRun && entry.tool?.callId === "agent-call",
      ),
    ).toBe(true),
  );
  const current = await store.session(id);
  const block = current.session.blocks.find((entry) => entry.tool?.callId === "agent-call")!;
  const command = {
    type: "stopItem",
    commandId: "stop-child",
    sessionId: id,
    runId: current.runId,
    blockId: block.id,
    callId: "agent-call",
  };
  await expect(
    engine.command({ ...command, commandId: "wrong-call", callId: "different" }),
  ).rejects.toThrow();
  await expect(
    engine.command({ ...command, commandId: "wrong-run", runId: "earlier" }),
  ).rejects.toThrow();
  const receipt = await engine.command(command);
  expect(await engine.command(command)).toEqual(receipt);
  await vi.waitFor(() =>
    expect(provider.stopItem).toHaveBeenCalledExactlyOnceWith(
      id,
      "agent-call",
      turns[0].input.operationContext,
    ),
  );
  expect(vi.mocked(provider.stopItem!).mock.calls[0]?.[2]).toBe(turns[0].input.operationContext);
  expect(provider.cancel).not.toHaveBeenCalled();
  expect(provider.stop).not.toHaveBeenCalled();
  expect((await store.session(id)).status).toBe("running");
  expect(
    (await store.session(id)).session.blocks.find((entry) => entry.id === block.id)?.tool?.status,
  ).toBe("running");
  turns[0].finish();
  await engine.waitForRun(id, runReceipt.runId);
  expect((await store.session(id)).status).toBe("idle");
});

it("rejects a historical pending agent block during a newer parent run and never cancels unsupported providers", async () => {
  const { engine, store, id, provider, turns, waitForTurnStart } = await setup("claude");
  const first = await engine.command({
    type: "send",
    commandId: "old-parent",
    sessionId: id,
    text: "Old task",
  });
  await waitForTurnStart();
  expect(turns).toHaveLength(1);
  turns[0].input.onAccepted?.();
  turns[0].input.onEvent({
    type: "tool.updated",
    callId: "old-call",
    kind: "agent",
    status: "running",
    agentPrompt: "Old review",
  });
  turns[0].input.onEvent({
    type: "agent.step",
    callId: "old-call",
    stepId: "step",
    kind: "message",
    text: "Inspecting",
  });
  await vi.waitFor(async () =>
    expect(
      (await store.session(id)).session.blocks.some(
        (entry) => entry.agentRun && entry.tool?.callId === "old-call",
      ),
    ).toBe(true),
  );
  const old = (await store.session(id)).session.blocks.find(
    (entry) => entry.tool?.callId === "old-call",
  )!;
  const unsupported = {
    type: "stopItem",
    commandId: "unsupported",
    sessionId: id,
    runId: (await store.session(id)).runId,
    blockId: old.id,
    callId: "old-call",
  };
  await expect(engine.command(unsupported)).rejects.toThrow(/provider cannot stop/);
  expect(provider.cancel).not.toHaveBeenCalled();
  turns[0].finish();
  await engine.waitForRun(id, first.runId);
  expect((await store.session(id)).status).toBe("idle");
  provider.stopItem = vi.fn(async () => {});
  const prior = await store.session(id);
  await store.save(
    {
      ...prior,
      revision: prior.revision + 1,
      session: {
        ...prior.session,
        blocks: prior.session.blocks.map((entry) =>
          entry.id === old.id
            ? {
                ...entry,
                tool: { ...entry.tool!, status: "running" },
                agentRun: { ...entry.agentRun!, endedAt: undefined },
              }
            : entry,
        ),
      },
    },
    { type: "test.pendingHistoricalAgent" },
  );
  const second = await engine.command({
    type: "send",
    commandId: "new-parent",
    sessionId: id,
    text: "New task",
  });
  await waitForTurnStart(2);
  expect(turns).toHaveLength(2);
  const current = await store.session(id);
  expect(current.session.blocks.find((entry) => entry.id === old.id)?.tool?.status).toBe("running");
  await expect(
    engine.command({ ...unsupported, commandId: "stale-agent", runId: current.runId }),
  ).rejects.toThrow(/subagent changed/);
  expect(provider.stopItem).not.toHaveBeenCalled();
  turns[1].finish();
  await engine.waitForRun(id, second.runId);
  expect((await store.session(id)).status).toBe("idle");
});

it("previews contextual transfers without execution and creates an idle handoff with the exact reviewed brief", async () => {
  const { engine, store, id, provider, turns, waitForTurnStart } = await setup();
  const runReceipt = await engine.command({
    type: "send",
    commandId: "source-context",
    sessionId: id,
    text: "Implement search",
  });
  await waitForTurnStart();
  expect(turns).toHaveLength(1);
  turns[0].input.onEvent({
    type: "message.delta",
    text: "Search implemented with keyboard support.",
  });
  turns[0].finish();
  await engine.waitForRun(id, runReceipt.runId);
  expect((await store.session(id)).status).toBe("idle");
  const source = await store.session(id);
  const reply = source.session.blocks.find((block) => block.role === "assistant")!;
  const input = {
    sessionId: id,
    sourceBlockId: reply.id,
    expectedRevision: source.revision,
    mode: "handoff",
    harness: "claude",
    model: "claude:test",
    modelSettings: {},
  };
  const preview = await engine.previewContextual(input);
  expect(provider.send).toHaveBeenCalledTimes(1);
  expect(preview.account).toBe("host-default");
  expect(preview.contextText).toContain("Search implemented");
  const command = {
    ...input,
    type: "contextual",
    commandId: "handoff-context",
    previewDigest: preview.digest,
  };
  const receipt = await engine.command(command);
  expect(await engine.command(command)).toEqual(receipt);
  expect(receipt.sessionId).not.toBe(id);
  const destination = await store.session(receipt.sessionId);
  expect(destination.status).toBe("idle");
  expect(destination.session.harness).toBe("claude");
  expect(destination.session.blocks.find((block) => block.handoff)?.text).toBe(preview.contextText);
  expect(destination.session.cwd).toBe(source.session.cwd);
  expect(destination.session.runtimeMode).toBe(source.session.runtimeMode);
  expect(await store.session(id)).toEqual(source);
  expect(provider.send).toHaveBeenCalledTimes(1);
});

it("binds second opinion to the reviewed source and target with one explicit new request", async () => {
  const { engine, store, id, provider, turns, waitForTurnStart } = await setup();
  const runReceipt = await engine.command({
    type: "send",
    commandId: "source-second",
    sessionId: id,
    text: "Review search",
  });
  await waitForTurnStart();
  expect(turns).toHaveLength(1);
  turns[0].input.onEvent({ type: "message.delta", text: "The search is correct." });
  turns[0].finish();
  await engine.waitForRun(id, runReceipt.runId);
  expect((await store.session(id)).status).toBe("idle");
  const source = await store.session(id);
  const reply = source.session.blocks.find((block) => block.role === "assistant")!;
  const input = {
    sessionId: id,
    sourceBlockId: reply.id,
    expectedRevision: source.revision,
    mode: "secondOpinion",
    harness: "claude",
    model: "claude:test",
    modelSettings: {},
  };
  const preview = await engine.previewContextual(input);
  await expect(
    engine.command({
      ...input,
      type: "contextual",
      commandId: "wrong-target-context",
      model: "changed",
      previewDigest: preview.digest,
    }),
  ).rejects.toThrow(/reviewed context changed/);
  await expect(
    engine.previewContextual({ ...input, providerAccountId: "other-account" }),
  ).rejects.toThrow(/default account/);
  const command = {
    ...input,
    type: "contextual",
    commandId: "second-context",
    previewDigest: preview.digest,
  };
  const receipt = await engine.command(command);
  expect(await engine.command(command)).toEqual(receipt);
  await waitForTurnStart(2);
  expect(turns).toHaveLength(2);
  expect(turns[1].input.sessionId).toBe(receipt.sessionId);
  expect(turns[1].input.text).toContain(preview.contextText);
  expect(turns[1].input.text).toContain("The search is correct");
  expect(
    (await store.session(receipt.sessionId)).session.blocks.find((block) => block.role === "user")
      ?.secondOpinion,
  ).toMatchObject({ from: "codex", to: "claude" });
  expect(await store.session(id)).toEqual(source);
  expect(provider.send).toHaveBeenCalledTimes(2);
  turns[1].finish();
  await vi.waitFor(async () =>
    expect((await store.session(receipt.sessionId)).status).toBe("idle"),
  );
  await engine.updateSession(id, { title: "Changed source" });
  await expect(engine.command({ ...command, commandId: "stale-source-context" })).rejects.toThrow(
    /source conversation changed/,
  );
});

it("previews a desktop-only source without adoption and rechecks its exact context after explicit adoption", async () => {
  const { engine, store, id, provider, turns, waitForTurnStart } = await setup();
  const runReceipt = await engine.command({
    type: "send",
    commandId: "desktop-source-turn",
    sessionId: id,
    text: "Continue search",
  });
  await waitForTurnStart();
  expect(turns).toHaveLength(1);
  turns[0].input.onEvent({ type: "message.delta", text: "Search work is ready." });
  turns[0].finish();
  await engine.waitForRun(id, runReceipt.runId);
  expect((await store.session(id)).status).toBe("idle");
  const base = await store.session(id);
  const epoch = Date.now();
  const desktop = {
    ...base,
    desktop: undefined,
    revision: epoch,
    updatedAt: epoch,
    session: { ...base.session, id: "desktop-source-only" },
  };
  const reply = desktop.session.blocks.find((block) => block.role === "assistant")!;
  const input = {
    sessionId: desktop.session.id,
    sourceBlockId: reply.id,
    expectedRevision: desktop.revision,
    mode: "handoff",
    harness: "claude",
    model: "claude:test",
    modelSettings: {},
  };
  const preview = await engine.previewContextual(input, desktop);
  await expect(store.session(desktop.session.id)).rejects.toThrow();
  expect(provider.send).toHaveBeenCalledTimes(1);
  await engine.adoptSession(desktop);
  const receipt = await engine.command({
    ...input,
    type: "contextual",
    commandId: "desktop-handoff",
    previewDigest: preview.digest,
  });
  expect(
    (await store.session(receipt.sessionId)).session.blocks.find((block) => block.handoff)?.text,
  ).toBe(preview.contextText);
  expect((await store.session(desktop.session.id)).session.blocks).toEqual(desktop.session.blocks);
  expect(provider.send).toHaveBeenCalledTimes(1);
});

it("Stop cancels a host follow-up waiting for provider startup", async () => {
  const { engine, store, id, provider, turns, waitForTurnStart } = await setup();
  provider.steer = vi.fn(async () => {});
  await engine.command({ type: "send", commandId: "start", sessionId: id, text: "first" });
  await waitForTurnStart();
  expect(turns).toHaveLength(1);
  const runId = (await store.session(id)).runId!;
  await engine.command({
    type: "steer",
    commandId: "redirect",
    sessionId: id,
    runId,
    text: "second",
  });
  await engine.command({ type: "cancel", commandId: "stop", sessionId: id, runId });
  await vi.waitFor(async () => expect((await store.session(id)).status).not.toBe("running"));
  expect(provider.steer).not.toHaveBeenCalled();
  expect(provider.send).toHaveBeenCalledOnce();
  expect(
    (await store.session(id)).session.blocks.find((block) => block.id === "redirect"),
  ).toMatchObject({
    draft: true,
    followUpDelivery: "undelivered",
    text: "second",
  });
});

it("retains rejected follow-ups and their attachments as drafts without replaying ambiguous delivery", async () => {
  const { engine, store, id, provider, turns, waitForTurnStart } = await setup();
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
  const runReceipt = await engine.command({
    type: "send",
    commandId: "start",
    sessionId: id,
    text: "first",
  });
  await waitForTurnStart();
  expect(turns).toHaveLength(1);
  turns[0].input.onAccepted?.();
  const command = {
    type: "steer",
    commandId: "rejected",
    sessionId: id,
    runId: (await store.session(id)).runId,
    text: "keep this follow-up",
    attachments: [file],
  };
  const receipt = await engine.command(command);
  await vi.waitFor(async () =>
    expect(
      (await store.session(id)).session.blocks.some((block) =>
        block.text.includes("Could not confirm delivery"),
      ),
    ).toBe(true),
  );
  turns[0].finish();
  await engine.waitForRun(id, runReceipt.runId);
  expect((await store.session(id)).status).toBe("idle");
  expect(
    (await store.session(id)).session.blocks.find((block) => block.id === command.commandId),
  ).toMatchObject({
    draft: true,
    followUpDelivery: "uncertain",
    text: command.text,
    attachments: [{ ...file, path: expect.any(String) }],
  });
  expect(await engine.command(command)).toEqual(receipt);
  expect(provider.steer).toHaveBeenCalledOnce();
  await engine.command({
    type: "send",
    commandId: "unrelated",
    sessionId: id,
    text: "another explicit prompt",
  });
  expect(
    (await store.session(id)).session.blocks.find((block) => block.id === command.commandId)?.draft,
  ).toBe(true);
});

it("keeps every accepted follow-up when the primary turn settles before startup acceptance", async () => {
  const { engine, store, id, provider, turns, waitForTurnStart } = await setup();
  provider.steer = vi.fn(async () => {});
  const runReceipt = await engine.command({
    type: "send",
    commandId: "start",
    sessionId: id,
    text: "first",
  });
  await waitForTurnStart();
  expect(turns).toHaveLength(1);
  for (const commandId of ["waiting-a", "waiting-b"]) {
    await engine.command({
      type: "steer",
      commandId,
      sessionId: id,
      runId: (await store.session(id)).runId,
      text: commandId,
    });
  }
  turns[0].finish();
  await engine.waitForRun(id, runReceipt.runId);
  expect((await store.session(id)).status).toBe("idle");
  expect(provider.steer).not.toHaveBeenCalled();
  expect((await store.session(id)).session.blocks.filter((block) => block.draft)).toMatchObject([
    { id: "waiting-a", text: "waiting-a", followUpDelivery: "undelivered" },
    { id: "waiting-b", text: "waiting-b", followUpDelivery: "undelivered" },
  ]);
  await engine.command({
    type: "send",
    commandId: "retry-a",
    sessionId: id,
    draftBlockId: "waiting-a",
    text: "waiting-a",
  });
  expect((await store.session(id)).session.blocks.some((block) => block.id === "waiting-a")).toBe(
    false,
  );
  expect(
    (await store.session(id)).session.blocks.find((block) => block.id === "waiting-b")?.draft,
  ).toBe(true);
  await waitForTurnStart(2);
  expect(turns).toHaveLength(2);
  expect(turns[1].input.text).toBe("waiting-a");
});

it("does not expose an idle session before in-flight follow-up delivery retires", async () => {
  const { engine, store, id, provider, turns, waitForTurnStart } = await setup();
  let rejectSteer!: (reason: Error) => void;
  provider.steer = vi.fn(
    () =>
      new Promise<void>((_, reject) => {
        rejectSteer = reject;
      }),
  );
  const runReceipt = await engine.command({
    type: "send",
    commandId: "start",
    sessionId: id,
    text: "first",
  });
  await waitForTurnStart();
  expect(turns).toHaveLength(1);
  turns[0].input.onAccepted?.();
  await engine.command({
    type: "steer",
    commandId: "in-flight",
    sessionId: id,
    runId: (await store.session(id)).runId,
    text: "second",
  });
  await vi.waitFor(() => expect(provider.steer).toHaveBeenCalledOnce());
  turns[0].finish();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(provider.stop).not.toHaveBeenCalled();
  expect((await store.session(id)).status).toBe("running");
  await expect(
    engine.command({ type: "send", commandId: "too-soon", sessionId: id, text: "third" }),
  ).rejects.toThrow("already running");
  rejectSteer(new Error("provider retired"));
  await engine.waitForRun(id, runReceipt.runId);
  expect((await store.session(id)).status).toBe("idle");
  expect(
    (await store.session(id)).session.blocks.find((block) => block.id === "in-flight"),
  ).toMatchObject({
    draft: true,
    followUpDelivery: "uncertain",
  });
});

it("persists the accepted run ID in receipts even after a replacement turn starts", async () => {
  const { engine, store, id, turns, waitForTurnStart } = await setup();
  const command = { type: "send", commandId: "first", sessionId: id, text: "first" };
  const receipt = await engine.command(command);
  expect(receipt.runId).toBe((await store.session(id)).runId);
  await waitForTurnStart();
  expect(turns).toHaveLength(1);
  turns[0].finish();
  await engine.waitForRun(id, receipt.runId);
  expect((await store.session(id)).status).toBe("idle");
  await engine.command({ type: "send", commandId: "replacement", sessionId: id, text: "second" });
  expect((await store.session(id)).runId).not.toBe(receipt.runId);
  expect(await engine.command(command)).toEqual(receipt);
  expect((await store.receiptStatus(command.commandId))?.runId).toBe(receipt.runId);
});

it("keeps a follow-up uncertain when Stop makes its provider resolve without delivery", async () => {
  const { engine, store, id, provider, turns, waitForTurnStart } = await setup();
  let finishSteer!: () => void;
  provider.steer = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishSteer = resolve;
      }),
  );
  await engine.command({ type: "send", commandId: "start", sessionId: id, text: "first" });
  await waitForTurnStart();
  expect(turns).toHaveLength(1);
  turns[0].input.onAccepted?.();
  const runId = (await store.session(id)).runId!;
  await engine.command({
    type: "steer",
    commandId: "redirect",
    sessionId: id,
    runId,
    text: "retain this",
  });
  await vi.waitFor(() => expect(provider.steer).toHaveBeenCalledOnce());
  await engine.command({ type: "cancel", commandId: "stop", sessionId: id, runId });
  finishSteer();
  await vi.waitFor(async () => expect((await store.session(id)).status).not.toBe("running"));
  expect(
    (await store.session(id)).session.blocks.find((block) => block.id === "redirect"),
  ).toMatchObject({
    draft: true,
    followUpDelivery: "uncertain",
    text: "retain this",
  });
});

it("protects a delivery draft from removal until the host turn retires", async () => {
  const { engine, store, id, provider, turns, waitForTurnStart } = await setup();
  let finishSteer!: () => void;
  provider.steer = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishSteer = resolve;
      }),
  );
  const runReceipt = await engine.command({
    type: "send",
    commandId: "start",
    sessionId: id,
    text: "first",
  });
  await waitForTurnStart();
  expect(turns).toHaveLength(1);
  await engine.command({
    type: "steer",
    commandId: "redirect",
    sessionId: id,
    runId: (await store.session(id)).runId!,
    text: "retain this",
  });
  await expect(
    engine.command({
      type: "removeDraft",
      commandId: "remove-pending",
      sessionId: id,
      draftBlockId: "redirect",
    }),
  ).rejects.toThrow("delivery is still active");
  turns[0].input.onAccepted?.();
  await vi.waitFor(() => expect(provider.steer).toHaveBeenCalledOnce());
  await expect(
    engine.command({
      type: "removeDraft",
      commandId: "remove-in-flight",
      sessionId: id,
      draftBlockId: "redirect",
    }),
  ).rejects.toThrow("delivery is still active");
  turns[0].finish();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(provider.stop).not.toHaveBeenCalled();
  finishSteer();
  await engine.waitForRun(id, runReceipt.runId);
  expect((await store.session(id)).status).toBe("idle");
  await engine.command({
    type: "removeDraft",
    commandId: "remove-retired",
    sessionId: id,
    draftBlockId: "redirect",
  });
  expect((await store.session(id)).session.blocks.some((block) => block.id === "redirect")).toBe(
    false,
  );
});

it("restores pending and uncertain follow-up drafts after restart without replay", async () => {
  const { store, provider, directory, id } = await setup();
  const current = await store.session(id);
  await store.save(
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
  await restarted.ready;
  cleanups.push(async () => {
    await restarted.close();
    await reopened.close();
  });
  expect((await reopened.session(id)).status).toBe("interrupted");
  expect((await reopened.session(id)).session.blocks.filter((block) => block.draft)).toMatchObject([
    { id: "not-started", followUpDelivery: "undelivered", draft: true },
    { id: "possibly-sent", followUpDelivery: "uncertain", draft: true },
  ]);
  expect(provider.send).not.toHaveBeenCalled();
});

it("atomically creates a first turn and deduplicates a lost reply", async () => {
  const { engine, store, project, provider, waitForTurnStart } = await setup();
  const beginFilesTurn = engine.checkpoints.beginFilesTurn.bind(engine.checkpoints);
  let preparing!: () => void;
  let releasePreparation!: () => void;
  const preparationStarted = new Promise<void>((resolve) => {
    preparing = resolve;
  });
  const preparationHold = new Promise<void>((resolve) => {
    releasePreparation = resolve;
  });
  const prepare = vi
    .spyOn(engine.checkpoints, "beginFilesTurn")
    .mockImplementation(async (...args) => {
      preparing();
      await preparationHold;
      return beginFilesTurn(...args);
    });
  const command = {
    type: "create",
    commandId: "atomic",
    projectId: project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
    firstTurn: { type: "send", commandId: "first", sessionId: "", text: "hello" },
  };
  try {
    const receipt = await engine.command(command);
    await preparationStarted;
    expect(receipt.runId).toBe((await store.session(receipt.sessionId)).runId);
    expect(await engine.command(command)).toEqual(receipt);
    expect(
      (await store.session(receipt.sessionId)).session.blocks.filter(
        (block) => block.role === "user",
      ),
    ).toHaveLength(1);
    expect(provider.send).not.toHaveBeenCalled();
    releasePreparation();
    await waitForTurnStart();
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(await store.sessions(project.id)).toHaveLength(2);
    await expect(
      engine.command({ ...command, firstTurn: { ...command.firstTurn, text: "changed" } }),
    ).rejects.toThrow();
  } finally {
    releasePreparation();
    prepare.mockRestore();
  }
});

it("rolls back creation and avoids provider dispatch when the first turn fails", async () => {
  const { engine, store, project, provider } = await setup();
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
  await expect(engine.command(command)).rejects.toThrow();
  expect(await store.sessions(project.id)).toHaveLength(1);
  expect(provider.send).not.toHaveBeenCalled();
});

it("recovers the same atomic receipt after orderly Host shutdown and durable store reopen", async () => {
  const { engine, store, directory, project, waitForTurnStart } = await setup();
  const command = {
    type: "create",
    commandId: "durable-atomic",
    projectId: project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
    firstTurn: { type: "send", commandId: "durable-first", sessionId: "", text: "once" },
  };
  const receipt = await engine.command(command);
  await waitForTurnStart();
  // Two concurrently live engine owners are not an abrupt process-crash fixture.
  await engine.close();
  await store.close();
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
  await restarted.ready;
  cleanups.push(async () => {
    await restarted.close();
    await reopened.close();
  });
  expect(await restarted.command(command)).toEqual(receipt);
  expect(send).not.toHaveBeenCalled();
  expect(
    (await reopened.session(receipt.sessionId)).session.blocks.filter(
      (block) => block.role === "user",
    ),
  ).toHaveLength(1);
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("Host writer transfer after settled task review", () => {
  it("retires the exact completed turn before desktop continuation and preserves resume history", async () => {
    const { engine, store, id, provider, turns, waitForTurnStart } = await setup();
    const receipt = await engine.command({
      type: "send",
      commandId: "review",
      sessionId: id,
      text: "Read-only review",
    });
    await waitForTurnStart();
    turns[0].input.onEvent({ type: "session.providerBound", providerSessionId: "review-thread" });
    turns[0].finish();
    await engine.waitForRun(id, receipt.runId);
    const before = await store.session(id);
    expect(before.status).toBe("idle");
    expect(engine.hasRetainedProviderWriter(id)).toBe(true);
    let release!: () => void;
    vi.mocked(provider.stop).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const grant = vi.fn(async () => "desktop-lease");
    const transfer = engine.withRetiredProviderWriter(id, grant);
    await vi.waitFor(() => expect(provider.stop).toHaveBeenCalledOnce());
    expect(provider.stop).toHaveBeenCalledWith(id, turns[0].input.operationContext);
    expect(grant).not.toHaveBeenCalled();
    expect(engine.hasRetainedProviderWriter(id)).toBe(true);
    release();
    expect(await transfer).toBe("desktop-lease");
    expect(grant).toHaveBeenCalledOnce();
    expect(engine.hasRetainedProviderWriter(id)).toBe(false);
    expect((await store.session(id)).session).toEqual(before.session);
    expect(provider.bind).toHaveBeenLastCalledWith(
      id,
      "review-thread",
      before.session.cwd,
      undefined,
    );
  });

  it("refuses continuation after failed retirement, retaining the original receipt on retry", async () => {
    const { engine, id, provider, turns, waitForTurnStart } = await setup();
    const receipt = await engine.command({
      type: "send",
      commandId: "review-fail",
      sessionId: id,
      text: "Review",
    });
    await waitForTurnStart();
    turns[0].finish();
    await engine.waitForRun(id, receipt.runId);
    vi.mocked(provider.stop).mockRejectedValueOnce(new Error("original writer retirement failed"));
    const grant = vi.fn(async () => "unsafe");
    await expect(engine.withRetiredProviderWriter(id, grant)).rejects.toThrow(
      "HOST_WRITER_RETIREMENT_FAILED",
    );
    await expect(engine.withRetiredProviderWriter(id, grant)).rejects.toThrow(
      "HOST_WRITER_RETIREMENT_FAILED",
    );
    expect(provider.stop).toHaveBeenCalledOnce();
    expect(engine.hasRetainedProviderWriter(id)).toBe(true);
    expect(grant).not.toHaveBeenCalled();
  });

  it("never retires an active turn to grant a desktop continuation", async () => {
    const { engine, id, provider, waitForTurnStart } = await setup();
    await engine.command({
      type: "send",
      commandId: "active-review",
      sessionId: id,
      text: "Review",
    });
    await waitForTurnStart();
    const grant = vi.fn(async () => "unsafe");
    await expect(engine.withRetiredProviderWriter(id, grant)).rejects.toThrow("LEASE_HELD");
    expect(provider.stop).not.toHaveBeenCalled();
    expect(grant).not.toHaveBeenCalled();
  });

  it("keeps a timed-out retirement guarded and joins its original completion on owner retry", async () => {
    const { engine, id, provider, turns, waitForTurnStart } = await setup();
    const receipt = await engine.command({
      type: "send",
      commandId: "pending-review",
      sessionId: id,
      text: "Review",
    });
    await waitForTurnStart();
    turns[0].finish();
    await engine.waitForRun(id, receipt.runId);
    const entered = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    vi.mocked(provider.stop).mockImplementationOnce(async () => {
      entered.resolve();
      await released.promise;
    });
    const grant = vi.fn(async () => "lease");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const transfer = engine.withRetiredProviderWriter(id, grant).catch((error: unknown) => error);
      await entered.promise;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await transfer).toMatchObject({
        message: expect.stringContaining("HOST_WRITER_RETIREMENT_PENDING"),
      });
      expect(grant).not.toHaveBeenCalled();
      expect(engine.hasRetainedProviderWriter(id)).toBe(true);
      await expect(
        engine.command({
          type: "send",
          commandId: "unsafe-replacement",
          sessionId: id,
          text: "Must wait",
        }),
      ).rejects.toThrow("HOST_WRITER_RETIREMENT_PENDING");
      expect(provider.send).toHaveBeenCalledOnce();
      released.resolve();
      expect(await engine.withRetiredProviderWriter(id, grant)).toBe("lease");
      expect(provider.stop).toHaveBeenCalledOnce();
      expect(engine.hasRetainedProviderWriter(id)).toBe(false);
    } finally {
      released.resolve();
      vi.useRealTimers();
    }
  });

  it("does not delete while title generation is pending", async () => {
    const { engine, store, id, provider } = await setup();
    const original = await store.session(id);
    await store.save(
      {
        ...original,
        revision: original.revision + 1,
        session: { ...original.session, blocks: [{ id: "message", role: "user", text: "Title" }] },
      },
      { type: "test.seed" },
    );
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    provider.generateTitle = vi.fn(async (input) => {
      entered.resolve();
      await release.promise;
      await runTextOperation(input.operationContext, async () => null);
      return { title: "Title", workItem: null };
    });
    const title = engine.command({
      type: "regenerateTitle",
      commandId: "pending-title",
      sessionId: id,
      expectedTitle: original.session.title,
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
    });
    await entered.promise;
    const remove = vi.fn(async () => store.deleteSession(id));
    const deletion = engine.withRetiredProviderWriterForDeletion(id, remove, async () => {});
    void deletion.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(remove).not.toHaveBeenCalled();
    release.resolve();
    await title;
    await deletion;
    await expect(store.session(id)).rejects.toThrow();
  });

  it.each([
    "success",
    "known-empty",
    "unknown",
    "custom",
    "swallowed-failure",
    "pending-second",
    "wrong-token",
  ] as const)("handles title-only %s before deletion", async (outcome) => {
    const { engine, store, id, provider } = await setup();
    const original = await store.session(id);
    await store.save(
      {
        ...original,
        revision: original.revision + 1,
        session: { ...original.session, blocks: [{ id: "message", role: "user", text: "Title" }] },
      },
      { type: "test.seed" },
    );
    provider.generateTitle = vi.fn(async (input) => {
      if (outcome === "success" || outcome === "known-empty")
        await runTextOperation(input.operationContext, async () => null);
      if (outcome === "swallowed-failure" || outcome === "pending-second") {
        await runTextOperation(input.operationContext, async () => null);
        if (outcome === "swallowed-failure") {
          await runTextOperation(input.operationContext, async () => {
            throw new Error("unknown utility cleanup");
          }).catch(() => {});
        } else {
          input.operationContext?.onUtilityStarted?.({});
        }
      }
      if (outcome === "wrong-token") {
        input.operationContext?.onUtilityStarted?.({});
        input.operationContext?.onUtilityCompleted?.({});
      }
      return outcome === "success" || outcome === "custom"
        ? { title: "Title", workItem: null }
        : null;
    });
    const command = {
      type: "regenerateTitle",
      commandId: `title-only-${outcome}`,
      sessionId: id,
      expectedTitle: original.session.title,
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
    };
    if (outcome === "success" || outcome === "known-empty") {
      if (outcome === "success") await engine.command(command);
      else await expect(engine.command(command)).rejects.toThrow("Could not generate");
      await engine.withRetiredProviderWriterForDeletion(
        id,
        async () => store.deleteSession(id),
        async () => {},
      );
      await expect(store.session(id)).rejects.toThrow();
    } else {
      if (outcome === "custom") await engine.command(command);
      else await expect(engine.command(command)).rejects.toThrow("Could not generate");
      const remove = vi.fn(async () => store.deleteSession(id));
      await expect(
        engine.withRetiredProviderWriterForDeletion(id, remove, async () => {}),
      ).rejects.toThrow("Other original provider work remains");
      expect(remove).not.toHaveBeenCalled();
      expect(await store.session(id)).toBeDefined();
    }
  });

  it("ignores completion callbacks after the original utility context closes", async () => {
    const { engine, store, id, provider } = await setup();
    const original = await store.session(id);
    await store.save(
      {
        ...original,
        revision: original.revision + 1,
        session: { ...original.session, blocks: [{ id: "message", role: "user", text: "Title" }] },
      },
      { type: "test.seed" },
    );
    let complete!: () => void;
    provider.generateTitle = vi.fn(async (input) => {
      const token = {};
      input.operationContext?.onUtilityStarted?.(token);
      complete = () => input.operationContext?.onUtilityCompleted?.(token);
      return { title: "Title", workItem: null };
    });
    await engine.command({
      type: "regenerateTitle",
      commandId: "late-title",
      sessionId: id,
      expectedTitle: original.session.title,
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
    });
    complete();
    const remove = vi.fn(async () => store.deleteSession(id));
    await expect(
      engine.withRetiredProviderWriterForDeletion(id, remove, async () => {}),
    ).rejects.toThrow("Other original provider work remains");
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes after completed title and warm turn retirement", async () => {
    const { engine, store, id, provider, turns, waitForTurnStart } = await setup();
    const receipt = await engine.command({
      type: "send",
      commandId: "title-before-delete",
      sessionId: id,
      text: "Review",
    });
    await waitForTurnStart();
    turns[0].finish();
    await engine.waitForRun(id, receipt.runId);
    provider.generateTitle = vi.fn(async () => ({ title: "Reviewed", workItem: null }));
    const current = await store.session(id);
    await engine.command({
      type: "regenerateTitle",
      commandId: "title-before-delete-2",
      sessionId: id,
      expectedTitle: current.session.title,
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
    });
    await engine.withRetiredProviderWriterForDeletion(
      id,
      async () => store.deleteSession(id),
      async () => {},
    );
    await expect(store.session(id)).rejects.toThrow();
  });

  it("holds deletion until the exact writer retires and never rebinds it", async () => {
    const { engine, store, id, provider, turns, waitForTurnStart } = await setup();
    const receipt = await engine.command({
      type: "send",
      commandId: "delete-writer",
      sessionId: id,
      text: "Review",
    });
    await waitForTurnStart();
    turns[0].finish();
    await engine.waitForRun(id, receipt.runId);
    const priorBindCount = vi.mocked(provider.bind).mock.calls.length;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    vi.mocked(provider.stop).mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
    });
    const admitted = vi.fn(async () => {});
    const remove = vi.fn(async () => {
      await store.deleteSession(id);
      return "removed";
    });
    const pending = engine.withRetiredProviderWriterForDeletion(id, remove, admitted);
    await entered.promise;
    expect(remove).not.toHaveBeenCalled();
    expect(await store.session(id)).toBeDefined();
    release.resolve();
    expect(await pending).toBe("removed");
    expect(admitted).toHaveBeenCalledTimes(2);
    expect(provider.stop).toHaveBeenCalledExactlyOnceWith(id, turns[0].input.operationContext);
    expect(vi.mocked(provider.bind)).toHaveBeenCalledTimes(priorBindCount);
    await expect(store.session(id)).rejects.toThrow();
  });

  it("blocks auxiliary provider admission throughout deletion and reopens it after failure", async () => {
    const { engine, id, provider } = await setup();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const internals = engine as unknown as {
      reserveProviderActivity(id: string, provider: HostProvider): unknown;
    };
    const pending = engine.withRetiredProviderWriterForDeletion(
      id,
      async () => {
        entered.resolve();
        await release.promise;
        throw new Error("fixture deletion failed");
      },
      async () => {},
    );
    await entered.promise;
    expect(() => internals.reserveProviderActivity(id, provider)).toThrow(
      "Session deletion is in progress",
    );
    release.resolve();
    await expect(pending).rejects.toThrow("fixture deletion failed");
    const activity = internals.reserveProviderActivity(id, provider) as {
      start(acquire: () => Promise<undefined>): Promise<void>;
      bookkeepingFinished(): void;
    };
    await activity.start(async () => undefined);
    activity.bookkeepingFinished();
  });

  it("refuses deletion while a different retained provider activity remains", async () => {
    const { engine, store, id, provider } = await setup();
    const internals = engine as unknown as {
      activityProviders: Map<object, { id: string; provider: HostProvider }>;
    };
    const other = {};
    internals.activityProviders.set(other, { id, provider });
    const remove = vi.fn(async () => store.deleteSession(id));
    try {
      await expect(
        engine.withRetiredProviderWriterForDeletion(id, remove, async () => {}),
      ).rejects.toThrow("Other original provider work remains");
      expect(remove).not.toHaveBeenCalled();
      expect(await store.session(id)).toBeDefined();
    } finally {
      internals.activityProviders.delete(other);
    }
  });

  it("rechecks deletion authority after waiting for writer retirement", async () => {
    const { engine, store, id, provider, turns, waitForTurnStart } = await setup();
    const receipt = await engine.command({
      type: "send",
      commandId: "delete-recheck",
      sessionId: id,
      text: "Review",
    });
    await waitForTurnStart();
    turns[0].finish();
    await engine.waitForRun(id, receipt.runId);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    vi.mocked(provider.stop).mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
    });
    let authorized = true;
    const admitted = async () => {
      if (!authorized) throw new Error("Authority changed");
    };
    const remove = vi.fn(async () => store.deleteSession(id));
    const pending = engine.withRetiredProviderWriterForDeletion(id, remove, admitted);
    await entered.promise;
    authorized = false;
    release.resolve();
    await expect(pending).rejects.toThrow("Authority changed");
    expect(remove).not.toHaveBeenCalled();
    expect(await store.session(id)).toBeDefined();
  });

  it("keeps session and original writer when deletion retirement is unknown", async () => {
    const { engine, store, id, provider, turns, waitForTurnStart } = await setup();
    const receipt = await engine.command({
      type: "send",
      commandId: "delete-unknown",
      sessionId: id,
      text: "Review",
    });
    await waitForTurnStart();
    turns[0].finish();
    await engine.waitForRun(id, receipt.runId);
    vi.mocked(provider.stop).mockRejectedValueOnce(new Error("unknown physical exit"));
    const remove = vi.fn(async () => {
      await store.deleteSession(id);
    });
    await expect(
      engine.withRetiredProviderWriterForDeletion(id, remove, async () => {}),
    ).rejects.toThrow("HOST_WRITER_RETIREMENT_FAILED");
    expect(remove).not.toHaveBeenCalled();
    expect(await store.session(id)).toBeDefined();
    expect(engine.hasRetainedProviderWriter(id)).toBe(true);
  });

  it("uses the latest settled Host turn receipt and refuses unsupported transfer", async () => {
    const { engine, id, provider, turns, waitForTurnStart } = await setup();
    for (let index = 0; index < 2; index++) {
      const receipt = await engine.command({
        type: "send",
        commandId: `warm-${index}`,
        sessionId: id,
        text: "Review",
      });
      await waitForTurnStart(index + 1);
      turns[index].finish();
      await engine.waitForRun(id, receipt.runId);
    }
    const internals = engine as unknown as {
      retainedWriterTurns: Map<string, Record<string, unknown>>;
      retainedProviders: Map<string, Set<HostProvider>>;
    };
    const retained = internals.retainedWriterTurns.get(id);
    expect(Object.keys(retained!).sort()).toEqual([
      "activity",
      "authorityGeneration",
      "cleanup",
      "operationContext",
      "provider",
    ]);
    expect(retained?.operationContext).toBe(turns[1].input.operationContext);
    const writers = (
      engine as unknown as { runWriters: { runs: WeakMap<object, { source?: unknown }> } }
    ).runWriters;
    const operationContext = retained!.operationContext as { hostRun: object };
    expect(writers.runs.get(operationContext.hostRun)?.source).toBeUndefined();
    expect((retained!.activity as { bookkeepingWork?: unknown }).bookkeepingWork).toBeUndefined();
    const hook = provider.retireOriginal;
    delete provider.retireOriginal;
    const grant = vi.fn(async () => "lease");
    await expect(engine.withRetiredProviderWriter(id, grant)).rejects.toThrow(
      "HOST_WRITER_RETIREMENT_FAILED",
    );
    expect(provider.stop).not.toHaveBeenCalled();
    expect(grant).not.toHaveBeenCalled();
    provider.retireOriginal = hook;
    await engine.withRetiredProviderWriter(id, grant);
    expect(provider.stop).toHaveBeenCalledExactlyOnceWith(id, turns[1].input.operationContext);
    expect(internals.retainedWriterTurns.has(id)).toBe(false);
    expect(internals.retainedProviders.has(id)).toBe(false);
  });
});

async function setup(
  harness: RemoteProvider = "codex",
  overrides: Partial<Record<RemoteProvider, HostProvider>> = {},
  managedTurns?: ManagedTurnHistoryAdapter,
  shell?: ConstructorParameters<typeof HostEngine>[2],
) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-engine-test-"));
  const store = new HostStore(join(directory, "host.db"));
  const project = await store.addProject(directory, "Test");
  const turns: Array<{ input: SendTurnInput; finish: () => void }> = [];
  const starts = new Map<number, { promise: Promise<void>; resolve: () => void }>();
  // A durable command receipt precedes real file-history/Git preparation. Wait
  // on the fake provider's actual admission, under the unchanged test timeout.
  const waitForTurnStart = (count = 1): Promise<void> => {
    if (turns.length >= count) return Promise.resolve();
    let signal = starts.get(count);
    if (!signal) {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      starts.set(count, (signal = { promise, resolve }));
    }
    return signal.promise;
  };
  const provider: HostProvider = {
    send: vi.fn(
      (input) =>
        new Promise<void>((resolve) => {
          turns.push({ input, finish: resolve });
          starts.get(turns.length)?.resolve();
          starts.delete(turns.length);
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
  provider.retireOriginal = provider.stop;
  const engine = new HostEngine(
    store,
    Object.fromEntries(REMOTE_PROVIDERS.map((id) => [id, overrides[id] ?? provider])),
    shell,
    managedTurns,
  );
  let expectedShutdownFailure: unknown;
  await engine.ready;
  const created = await engine.command({
    type: "create",
    commandId: "create",
    workspaceMode: "current",
    projectId: project.id,
    harness,
    model: `${harness}:test`,
    runtimeMode: "supervised",
  });
  cleanups.push(async () => {
    let failure: unknown;
    try {
      await engine.close();
    } catch (error) {
      if (error !== expectedShutdownFailure) failure = error;
    }
    await store.close();
    rmSync(directory, { recursive: true, force: true });
    if (failure) throw failure;
  });
  return {
    directory,
    store,
    provider,
    project,
    engine,
    turns,
    waitForTurnStart,
    observeExpectedShutdownFailure: async () => {
      const result = await engine.close().then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(result).toBeInstanceOf(AggregateError);
      expectedShutdownFailure = result;
      return result;
    },
    id: created.sessionId,
  };
}

function managedHistory() {
  const records = new Map<string, TurnGitRecord>();
  const snapshot: TurnGitSnapshot = {
    head: "a".repeat(40),
    index: "b".repeat(40),
    worktree: "c".repeat(40),
    indexMetadataId: "metadata",
    paths: [],
    capturedAt: 1,
  };
  const adapter: ManagedTurnHistoryAdapter = {
    exactGitRewindEnabled: () => true,
    workspaceForSession: vi.fn(async () => ({ workspaceId: "managed" })),
    assertWritable: vi.fn(async () => {}),
    history: {
      begin: vi.fn(async (request) => {
        const record: TurnGitRecord = {
          ...request,
          branchRef: "refs/heads/bycoda/s/test",
          before: { status: "complete", snapshot },
        };
        records.set(request.userBlockId, record);
        return record;
      }),
      end: vi.fn(async (request) => {
        const record = records.get(request.userBlockId)!;
        record.after = { status: "complete", snapshot };
        return record;
      }),
      get: vi.fn(async (_workspace, turn) => records.get(turn) ?? null),
      list: vi.fn(async () => [...records.values()]),
    },
  };
  return { adapter, records };
}

describe("managed turn boundaries", () => {
  it("uses successful post-write Codex proof without late pre-edit capture", async () => {
    const { engine, store, id, directory, turns, waitForTurnStart } = await setup();
    const cwd = join(directory, "proof-repo");
    mkdirSync(cwd);
    writeFileSync(join(cwd, "own.txt"), "before\n");
    const git = (...args: string[]) => execFileAsync("git", args, { cwd, windowsHide: true });
    await git("init", "-q");
    await git("config", "user.name", "Test");
    await git("config", "user.email", "test@example.invalid");
    await git("add", ".");
    await git("commit", "-qm", "initial");
    const initial = await store.session(id);
    await store.save(
      { ...initial, revision: initial.revision + 1, session: { ...initial.session, cwd } },
      { type: "test.checkout" },
    );
    const prepare = vi.spyOn(engine.checkpoints, "prepareFilesTurn");
    const legacyClaim = vi.spyOn(engine.checkpoints, "claim");
    const receipt = await engine.command({
      type: "send",
      commandId: "proof-message",
      sessionId: id,
      text: "Replace file",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    writeFileSync(join(cwd, "own.txt"), "after\n");
    for (const [callId, kind, contents] of [
      ["delete", "delete", "before\n"],
      ["add", "add", "after\n"],
    ] as const) {
      const proof = [{ path: "own.txt", kind, contents }];
      turns[0].input.onEvent({
        type: "tool.started",
        callId,
        kind: "write",
        paths: ["own.txt"],
        fileChanges: proof,
        title: "Write own.txt",
      });
      turns[0].input.onEvent({
        type: "tool.updated",
        callId,
        kind: "write",
        paths: ["own.txt"],
        fileChanges: proof,
        status: "completed",
      });
      turns[0].input.onEvent({
        type: "tool.updated",
        callId,
        kind: "write",
        paths: ["own.txt"],
        fileChanges: proof,
        status: "completed",
      });
    }
    // A failed or empty started notification is not evidence of a successful write.
    turns[0].input.onEvent({
      type: "tool.started",
      callId: "failed",
      title: "Write own.txt",
      kind: "write",
      fileChanges: [],
    });
    turns[0].input.onEvent({
      type: "tool.updated",
      callId: "failed",
      kind: "write",
      status: "failed",
      fileChanges: [],
    });
    turns[0].finish();
    await engine.waitForRun(id, receipt.runId);
    expect(prepare).not.toHaveBeenCalled();
    expect(legacyClaim).not.toHaveBeenCalled();
    expect(await engine.checkpoints.filesRevertPlan(id, cwd, "proof-message")).toEqual({
      files: [{ path: "own.txt", action: "restore", conflict: undefined }],
    });
    expect((await engine.checkpoints.filesRevert(id, cwd, "proof-message")).reverted).toEqual([
      "own.txt",
    ]);
    expect(readFileSync(join(cwd, "own.txt"), "utf8")).toBe("before\n");
  });
  it.each([false, true])(
    "records and safely restores per-message files with exact rewind OFF (worktree %s)",
    async (managed) => {
      const { engine, store, id, directory, provider, turns, waitForTurnStart } = await setup();
      const cwd = join(directory, "repo");
      mkdirSync(cwd);
      writeFileSync(join(cwd, "own.txt"), "before own\n");
      writeFileSync(join(cwd, "foreign.txt"), "before foreign\n");
      const git = (...args: string[]) => execFileAsync("git", args, { cwd, windowsHide: true });
      await git("init", "-q");
      await git("config", "user.name", "Test");
      await git("config", "user.email", "test@example.invalid");
      await git("add", ".");
      await git("commit", "-qm", "initial");
      const initial = await store.session(id);
      await store.save(
        {
          ...initial,
          revision: initial.revision + 1,
          session: {
            ...initial.session,
            cwd,
            ...(managed ? { workspaceId: "managed", worktreeCwd: cwd } : {}),
          },
        },
        { type: "test.checkout" },
      );
      const { adapter } = managedHistory();
      adapter.exactGitRewindEnabled = () => false;
      adapter.workspaceForSession = async () =>
        managed ? { workspaceId: "managed", path: cwd } : null;
      engine.setManagedTurnHistoryAdapter(adapter);
      const receipt = await engine.command({
        type: "send",
        commandId: "edit-files-message",
        sessionId: id,
        text: "Edit two files",
      });
      await waitForTurnStart();
      expect(turns).toHaveLength(1);
      writeFileSync(join(cwd, "own.txt"), "own edit\n");
      writeFileSync(join(cwd, "foreign.txt"), "session edit\n");
      turns[0].input.onEvent({
        type: "tool.updated",
        callId: "edit",
        kind: "write",
        status: "completed",
        paths: ["own.txt", "foreign.txt"],
      });
      turns[0].finish();
      await engine.waitForRun(id, receipt.runId);
      expect(provider.stop).not.toHaveBeenCalled();
      const plan = await engine.checkpoints.filesRevertPlan(id, cwd, "edit-files-message");
      expect(plan.unavailable).toBeUndefined();
      expect(plan.files.map((file) => file.path).sort()).toEqual(["foreign.txt", "own.txt"]);
      writeFileSync(join(cwd, "foreign.txt"), "someone else\n");
      const result = await engine.checkpoints.filesRevert(id, cwd, "edit-files-message");
      expect(result.reverted).toEqual(["own.txt"]);
      expect(result.skipped.map((file) => file.path)).toEqual(["foreign.txt"]);
      expect(readFileSync(join(cwd, "own.txt"), "utf8")).toBe("before own\n");
      expect(readFileSync(join(cwd, "foreign.txt"), "utf8")).toBe("someone else\n");
      await engine.rewind({
        type: "rewind",
        commandId: "rewind-edits",
        sessionId: id,
        blockId: "edit-files-message",
      });
      expect((await store.session(id)).session.blocks).toEqual([]);
      expect(
        (await engine.checkpoints.filesRevertPlan(id, cwd, "edit-files-message")).unavailable,
      ).toBeTruthy();
    },
  );
  it.each(["unset", "off"])(
    "runs three lightweight worktree sends without capture, admission or retirement (%s)",
    async (setting) => {
      const { store, id, provider, turns, directory, waitForTurnStart } = await setup();
      const original = await store.session(id);
      await store.save(
        {
          ...original,
          revision: original.revision + 1,
          status: "running",
          runId: "old-stuck-turn",
          session: { ...original.session, workspaceId: "managed", worktreeCwd: directory },
        },
        { type: "test.stuck-managed-turn" },
      );
      const { adapter } = managedHistory();
      if (setting === "unset") delete adapter.exactGitRewindEnabled;
      else adapter.exactGitRewindEnabled = async () => false;
      adapter.workspaceForSession = vi.fn(async () => ({
        workspaceId: "managed",
        path: directory,
      }));
      vi.mocked(adapter.assertWritable).mockRejectedValue(new Error("Old native writer is active"));
      vi.mocked(adapter.history.list).mockRejectedValue(new Error("Old turn has no after capture"));
      adapter.startActivity = vi.fn(async () => {
        throw new Error("Another workspace writer is active");
      });
      const restarted = new HostEngine(store, { codex: provider }, undefined, adapter);
      cleanups.push(() => restarted.close());
      await restarted.ready;
      expect((await store.session(id)).status).toBe("interrupted");
      const legacyBegin = vi.spyOn(restarted.checkpoints, "begin");
      const legacyFinish = vi.spyOn(restarted.checkpoints, "finish");
      for (let turn = 0; turn < 3; turn += 1) {
        expect(await restarted.busyReason(id)).toBeUndefined();
        const receipt = await restarted.command({
          type: "send",
          commandId: `light-send-${turn}`,
          sessionId: id,
          text: `Send ${turn}`,
        });
        await waitForTurnStart(turn + 1);
        expect(turns).toHaveLength(turn + 1);
        expect(turns[turn].input.cwd).toBe(directory);
        turns[turn].finish();
        await restarted.waitForRun(id, receipt.runId);
        expect((await store.session(id)).status).toBe("idle");
      }
      expect(adapter.workspaceForSession).toHaveBeenCalled();
      expect(adapter.assertWritable).not.toHaveBeenCalled();
      expect(adapter.startActivity).not.toHaveBeenCalled();
      expect(adapter.history.begin).not.toHaveBeenCalled();
      expect(adapter.history.end).not.toHaveBeenCalled();
      expect(adapter.history.list).not.toHaveBeenCalled();
      expect(legacyBegin).not.toHaveBeenCalled();
      expect(legacyFinish).not.toHaveBeenCalled();
      expect(provider.stop).not.toHaveBeenCalled();
      await restarted.close();
      expect(provider.stop).toHaveBeenCalledExactlyOnceWith(id);
    },
  );

  it.each([
    ["codex", true],
    ["codex", false],
    ["opencode", true],
    ["opencode", false],
  ] as const)(
    "rewinds only the lightweight transcript without provider file revert (%s, metadata %s)",
    async (harness, hasMetadata) => {
      const { adapter } = managedHistory();
      adapter.exactGitRewindEnabled = () => false;
      const { engine, store, id, provider, directory } = await setup(harness, {}, adapter);
      const editedFile = join(directory, "retain-edits.txt");
      writeFileSync(editedFile, "Keep the current file edits");
      const original = await store.session(id);
      await store.save(
        {
          ...original,
          revision: original.revision + 1,
          session: {
            ...original.session,
            workspaceId: hasMetadata ? "managed" : undefined,
            providerSessionId: "old-provider",
            blocks: [
              { id: "keep-user", role: "user", text: "keep" },
              { id: "remove-user", role: "user", text: "edit me", providerTurnId: "native-turn" },
              { id: "remove-assistant", role: "assistant", text: "old answer" },
            ],
          },
        },
        { type: "test.lightweight-rewind" },
      );
      provider.rewind = vi.fn(async () => {
        writeFileSync(editedFile, "Provider reverted the file");
      });
      await engine.rewind({
        type: "rewind",
        commandId: "lightweight-rewind",
        sessionId: id,
        blockId: "remove-user",
      });
      expect((await store.session(id)).session.blocks.map((block) => block.id)).toEqual([
        "keep-user",
      ]);
      expect(provider.rewind).not.toHaveBeenCalled();
      const rewound = (await store.session(id)).session;
      expect(rewound.providerSessionId).toBeUndefined();
      expect(rewound.pendingContextReplay).toContain("keep");
      expect(readFileSync(editedFile, "utf8")).toBe("Keep the current file edits");
      expect(adapter.assertWritable).not.toHaveBeenCalled();
    },
  );

  it("keeps unavailable managed sessions unchanged during startup while recovering legacy sessions", async () => {
    const { store, engine, id, provider, project } = await setup();
    const legacy = await engine.command({
      type: "create",
      commandId: "legacy-startup",
      projectId: project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const original = await store.session(id);
    const retained = await store.save(
      {
        ...original,
        revision: original.revision + 1,
        status: "running",
        runId: "unavailable-run",
        session: {
          ...original.session,
          workspaceId: "retired-workspace",
          providerSessionId: "unavailable-provider",
          blocks: [
            {
              id: "retained-shell",
              role: "system",
              text: "",
              shell: { command: "pending", output: "retained", exitCode: null, running: true },
            },
          ],
        },
      },
      { type: "test.retired-workspace" },
    );
    const legacyValue = await store.session(legacy.sessionId);
    await store.save(
      {
        ...legacyValue,
        revision: legacyValue.revision + 1,
        status: "running",
        runId: "legacy-run",
        session: { ...legacyValue.session, providerSessionId: "legacy-provider" },
      },
      { type: "test.legacy-startup" },
    );
    const { adapter } = managedHistory();
    adapter.workspaceForSession = async (value) => {
      if (value.session.workspaceId)
        throw new Error("Workspace directory was removed; resume it first");
      return null;
    };
    vi.mocked(provider.bind).mockClear();
    const restarted = new HostEngine(store, { codex: provider }, undefined, adapter);
    cleanups.push(() => restarted.close());
    await restarted.ready;
    expect(await store.session(id)).toEqual(retained);
    expect((await store.session(legacy.sessionId)).status).toBe("interrupted");
    expect(restarted.recoveredInterrupted).toEqual([legacy.sessionId]);
    expect(vi.mocked(provider.bind).mock.calls.map(([sessionId]) => sessionId)).not.toContain(id);
    expect(provider.bind).toHaveBeenCalledWith(
      legacy.sessionId,
      "legacy-provider",
      legacyValue.session.cwd,
      undefined,
    );
    await expect(
      restarted.command({
        type: "send",
        commandId: "retired-send",
        sessionId: id,
        text: "continue",
      }),
    ).rejects.toThrow("Workspace directory was removed");
    expect(provider.send).not.toHaveBeenCalled();
    expect(await store.session(id)).toEqual(retained);
  });

  it("normalizes adopted project cwd and dispatches stale managed snapshots in the authoritative execution directory", async () => {
    const { engine, store, id, directory, turns, provider, waitForTurnStart } = await setup();
    const { adapter } = managedHistory();
    const owned = join(directory, "owned-execution");
    mkdirSync(owned);
    adapter.workspaceForSession = async (value) =>
      value.session.workspaceId ? { workspaceId: value.session.workspaceId, path: owned } : null;
    engine.setManagedTurnHistoryAdapter(adapter);
    const original = await store.session(id);
    const adopted = await engine.adoptSession({
      ...original,
      session: {
        ...original.session,
        id: "adopted-managed",
        workspaceId: "managed",
        cwd: directory,
        worktreeCwd: owned,
      },
    });
    expect(adopted.session.cwd).toBe(owned);
    // Older persisted snapshots can still carry project identity in cwd. Execution
    // must always derive its directory from the registry at admission.
    await store.save(
      {
        ...adopted,
        revision: adopted.revision + 1,
        session: { ...adopted.session, cwd: directory },
      },
      { type: "test.legacy-cwd" },
    );
    provider.generateTitle = vi.fn(async () => null);
    await engine.command({
      type: "send",
      commandId: "owned-cwd",
      sessionId: adopted.session.id,
      text: "Implement here",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    expect(turns[0].input.cwd).toBe(owned);
    await vi.waitFor(() =>
      expect(provider.generateTitle).toHaveBeenCalledWith({
        sessionId: adopted.session.id,
        cwd: owned,
        message: "Implement here",
        providerAccountId: undefined,
        operationContext: expect.objectContaining({
          hostRun: expect.any(Object),
          hostControlRun: expect.any(Object),
        }),
      }),
    );
    turns[0].finish();
  });

  it.each(["missing", "failure", "current"])(
    "accepts only authoritative Current contextual preparation (%s)",
    async (resolution) => {
      const { engine, store, id, directory } = await setup();
      const original = await store.session(id);
      await store.save(
        {
          ...original,
          revision: original.revision + 1,
          session: {
            ...original.session,
            worktreeCwd: directory,
            branch: "existing-branch",
            blocks: [
              { id: "source-user", role: "user", text: "Implement search" },
              { id: "source-reply", role: "assistant", text: "Search is implemented." },
            ],
          },
        },
        { type: "test.contextual-source" },
      );
      const { adapter } = managedHistory();
      adapter.workspaceForSession = async () => null;
      const prepare = vi.fn(async () => {
        if (resolution === "failure") throw new Error("Selected Worktree preparation failed");
        return { workspaceMode: "current" as const, path: directory };
      });
      if (resolution !== "missing") adapter.prepareContextualWorkspace = prepare;
      adapter.prepareWorkspaceForCreate = vi.fn(async () => {
        throw new Error("Must use the authoritative contextual result");
      });
      engine.setManagedTurnHistoryAdapter(adapter);
      const source = await store.session(id);
      const input = {
        sessionId: id,
        sourceBlockId: "source-reply",
        expectedRevision: source.revision,
        mode: "handoff",
        harness: "claude",
        model: "claude:test",
        modelSettings: {},
      };
      const preview = await engine.previewContextual(input);
      const command = {
        ...input,
        type: "contextual",
        commandId: "contextual-policy",
        previewDigest: preview.digest,
      };
      if (resolution !== "current") {
        await expect(engine.command(command)).rejects.toThrow(
          resolution === "failure"
            ? "Selected Worktree preparation failed"
            : "Prepare a separate managed workspace",
        );
        expect(await store.sessions()).toHaveLength(1);
      } else {
        const created = await engine.command(command);
        expect(await engine.command(command)).toEqual(created);
        expect(prepare).toHaveBeenCalledOnce();
        expect((await store.session(created.sessionId)).session).toMatchObject({
          cwd: directory,
          worktreeCwd: directory,
          branch: "existing-branch",
          workspaceMode: "current",
        });
        expect((await store.session(created.sessionId)).session.workspaceId).toBeUndefined();
      }
      expect(adapter.prepareWorkspaceForCreate).not.toHaveBeenCalled();
      expect(await store.session(id)).toEqual(source);
    },
  );

  it("allocates a separate owned workspace for a managed contextual writer", async () => {
    const { engine, store, id, directory } = await setup();
    const original = await store.session(id);
    await store.save(
      {
        ...original,
        revision: original.revision + 1,
        session: {
          ...original.session,
          workspaceId: "source-workspace",
          worktreeCwd: directory,
          branch: "bycoda/s/source",
          blocks: [
            { id: "source-user", role: "user", text: "Implement search" },
            { id: "source-reply", role: "assistant", text: "Search is implemented." },
          ],
        },
      },
      { type: "test.managed-source" },
    );
    const { adapter } = managedHistory();
    let destinationId = "";
    adapter.workspaceForSession = async (value) =>
      value.session.workspaceId ? { workspaceId: value.session.workspaceId } : null;
    adapter.prepareContextualWorkspace = vi.fn(async (request) => {
      destinationId = request.sessionId;
      return { workspaceId: "destination-workspace" };
    });
    adapter.workspaceForCreate = async () => ({
      workspaceId: "destination-workspace",
      sessionId: destinationId,
      path: join(directory, "destination"),
      branchRef: "refs/heads/bycoda/s/destination",
      revision: 1,
    });
    engine.setManagedTurnHistoryAdapter(adapter);
    const source = await store.session(id);
    const input = {
      sessionId: id,
      sourceBlockId: "source-reply",
      expectedRevision: source.revision,
      mode: "handoff",
      harness: "claude",
      model: "claude:test",
      modelSettings: {},
    };
    const preview = await engine.previewContextual(input);
    const command = {
      ...input,
      type: "contextual",
      commandId: "managed-context",
      previewDigest: preview.digest,
    };
    const receipt = await engine.command(command);
    expect(await engine.command(command)).toEqual(receipt);
    expect(adapter.prepareContextualWorkspace).toHaveBeenCalledTimes(1);
    expect((await store.session(receipt.sessionId)).session).toMatchObject({
      workspaceId: "destination-workspace",
      cwd: join(directory, "destination"),
      worktreeCwd: join(directory, "destination"),
      branch: "bycoda/s/destination",
    });
    expect(await store.session(id)).toEqual(source);
  });

  it("creates unattended managed sessions with authoritative identity and holds admission through provider completion", async () => {
    const { engine, store, project, directory, turns, waitForTurnStart } = await setup();
    const { adapter } = managedHistory();
    const release = vi.fn(async () => {});
    mkdirSync(join(directory, "owned"));
    adapter.workspaceForSession = async (value) =>
      value.session.workspaceId ? { workspaceId: value.session.workspaceId } : null;
    adapter.workspaceForCreate = vi.fn(async () => ({
      workspaceId: "managed",
      sessionId: "prepared-session",
      path: join(directory, "owned"),
      branchRef: "refs/heads/bycoda/s/owned",
      revision: 7,
    }));
    adapter.startActivity = vi.fn(async () => release);
    engine.setManagedTurnHistoryAdapter(adapter);
    const launched = await launchSessionRun(store, engine, {
      requestId: "managed-run",
      projectId: project.id,
      workspaceId: "managed",
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "supervised",
      title: "Owned run",
      prompt: "Implement the change",
    });
    expect(launched.error).toBeUndefined();
    expect(launched.sessionId).toBe("prepared-session");
    const saved = await store.session("prepared-session");
    expect(saved.session).toMatchObject({
      workspaceId: "managed",
      workspaceRevision: 7,
      cwd: join(directory, "owned"),
      worktreeCwd: join(directory, "owned"),
      branch: "bycoda/s/owned",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    expect(adapter.startActivity).toHaveBeenCalledWith(expect.anything(), "provider");
    expect(turns[0].input.cwd).toBe(join(directory, "owned"));
    expect(release).not.toHaveBeenCalled();
    turns[0].finish();
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    await expect(
      engine.command({
        type: "create",
        commandId: "duplicate-owner",
        projectId: project.id,
        workspaceId: "managed",
        harness: "codex",
        model: "codex:test",
        runtimeMode: "supervised",
      }),
    ).rejects.toThrow("already has its session");
  });

  it("rejects managed create without a resolver and rejects malformed workspace identity", async () => {
    const { engine, project } = await setup();
    const command = {
      type: "create",
      commandId: "unresolved-owner",
      projectId: project.id,
      workspaceId: "managed",
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    };
    await expect(engine.command(command)).rejects.toThrow("authoritative workspace ownership");
    expect(() => parseCommand({ ...command, workspaceId: "" })).toThrow("Invalid workspace ID");
    engine.setManagedTurnHistoryAdapter(managedHistory().adapter);
    await expect(engine.command({ ...command, workspaceId: undefined })).rejects.toThrow(
      "requires workspace preparation",
    );
  });

  it("defers managed startup settlement until shared recovery services are attached", async () => {
    const { store, id, provider } = await setup();
    const value = await store.session(id);
    await store.save(
      {
        ...value,
        revision: value.revision + 1,
        status: "running",
        runId: "interrupted-managed-run",
        session: { ...value.session, workspaceId: "managed" },
      },
      { type: "test.interrupted" },
    );
    const restarted = new HostEngine(store, { codex: provider });
    cleanups.push(() => restarted.close());
    await restarted.ready;
    expect((await store.session(id)).status).toBe("running");
    const { adapter } = managedHistory();
    restarted.setManagedTurnHistoryAdapter(adapter);
    await restarted.recoverManagedStartup();
    expect((await store.session(id)).status).toBe("interrupted");
    expect(restarted.recoveredInterrupted).toEqual([id]);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("blocks provider and shell starts at the shared gate without leaving a running shell", async () => {
    const shell = vi.fn(async () => ({ output: "unexpected", exitCode: 0, timedOut: false }));
    const { adapter } = managedHistory();
    const gateFailure = new Error("Workspace reservation is active");
    let attempts = 0;
    let bothAttempted!: () => void;
    const bothOriginalAttempts = new Promise<void>((resolve) => {
      bothAttempted = resolve;
    });
    adapter.startActivity = vi.fn(async () => {
      // Do not let the background title's earlier failure preclude the main
      // turn's actual acquisition attempt. Both original attempts must be known.
      if (++attempts === 2) bothAttempted();
      await bothOriginalAttempts;
      throw gateFailure;
    });
    const { engine, store, id, provider, observeExpectedShutdownFailure } = await setup(
      "codex",
      {},
      adapter,
      shell,
    );
    provider.generateTitle = vi.fn(async () => null);
    const receipt = await engine.command({
      type: "send",
      commandId: "blocked-provider",
      sessionId: id,
      text: "go",
    });
    await bothOriginalAttempts;
    expect(adapter.startActivity).toHaveBeenCalledTimes(2);
    // The refused start still settles the session (idle, never stuck "running").
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await engine.waitForRun(id, receipt.runId);
    expect((await store.session(id)).status).toBe("idle");
    expect(provider.send).not.toHaveBeenCalled();
    expect(provider.generateTitle).not.toHaveBeenCalled();
    expect(adapter.history.begin).not.toHaveBeenCalled();
    await engine.command({
      type: "shell",
      commandId: "blocked-shell",
      sessionId: id,
      line: "git status",
    });
    await vi.waitFor(async () => {
      const block = (await store.session(id)).session.blocks.find(
        (entry) => entry.id === "blocked-shell",
      );
      expect(block?.shell?.running).toBeUndefined();
      expect(block?.shell?.output).toBe("Workspace reservation is active");
    });
    expect(shell).not.toHaveBeenCalled();
    const failure = await observeExpectedShutdownFailure();
    const leaves = (error: unknown): unknown[] =>
      error instanceof AggregateError ? error.errors.flatMap(leaves) : [error];
    expect(leaves(failure)).toContain(gateFailure);
  });

  it("binds immutable transcript rescue to the checked conversation revision", async () => {
    const { engine, store, id } = await setup();
    const adapter = engine.conversationRewindAdapter();
    const before = await store.session(id);
    await expect(adapter.rescue("revision-bound", id, before.revision + 1)).rejects.toThrow(
      "changed before transcript rescue",
    );
    expect(await adapter.rescue("revision-bound", id, before.revision)).toBe("revision-bound");
    await engine.updateSession(id, { title: "later change" });
    const current = await store.session(id);
    await expect(adapter.rescue("revision-bound", id, before.revision)).rejects.toThrow(
      "changed before transcript rescue",
    );
    await expect(adapter.rescue("revision-bound", id, current.revision)).rejects.toThrow(
      "rescue revision does not match",
    );
  });

  it("blocks concurrent metadata and command writers through the session gate", async () => {
    const { engine, store, id, provider } = await setup();
    const before = await store.session(id);
    await engine.conversationRewindAdapter().withSessionGate(id, async () => {
      await expect(engine.updateSession(id, { title: "racing change" })).rejects.toThrow(
        "conversation change",
      );
      await expect(
        engine.command({ type: "send", commandId: "racing-send", sessionId: id, text: "change" }),
      ).rejects.toThrow("conversation change");
    });
    expect(await store.session(id)).toEqual(before);
    expect(provider.send).not.toHaveBeenCalled();
    await engine.updateSession(id, { title: "after release" });
    expect((await store.session(id)).session.title).toBe("after release");
  });

  it("captures each delivered steer before sending it and completes every accepted boundary", async () => {
    const { adapter, records } = managedHistory();
    const { engine, store, id, provider, turns, waitForTurnStart } = await setup(
      "codex",
      {},
      adapter,
    );
    provider.steer = vi.fn(async () => {
      expect(records.has("steer-boundary")).toBe(true);
    });
    const receipt = await engine.command({
      type: "send",
      commandId: "primary-boundary",
      sessionId: id,
      text: "work",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    turns[0].input.onAccepted?.();
    await engine.command({
      type: "steer",
      commandId: "steer-boundary",
      sessionId: id,
      runId: receipt.runId,
      text: "also this",
    });
    await vi.waitFor(async () =>
      expect(
        (await store.session(id)).session.blocks.find((block) => block.id === "steer-boundary")
          ?.draft,
      ).not.toBe(true),
    );
    turns[0].finish();
    await engine.waitForRun(id, receipt.runId);
    expect((await store.session(id)).status).toBe("idle");
    expect([...records.keys()]).toEqual(["primary-boundary", "steer-boundary"]);
    expect(records.get("primary-boundary")?.after?.status).toBe("complete");
    expect(records.get("steer-boundary")?.after?.status).toBe("complete");
  });

  it("atomically rewinds and undoes the Host transcript with durable duplicate receipts and fresh replay", async () => {
    const { engine, store, id } = await setup();
    const initial = await store.session(id);
    await store.save(
      {
        ...initial,
        revision: initial.revision + 1,
        session: {
          ...initial.session,
          providerSessionId: "old-binding",
          blocks: [
            { id: "retained", role: "user", text: "retained context" },
            { id: "remove", role: "user", text: "removed prompt" },
            { id: "answer", role: "assistant", text: "removed answer" },
          ],
        },
      },
      { type: "fixture" },
    );
    const adapter = engine.conversationRewindAdapter();
    const before = await adapter.read(id);
    await adapter.settle(id);
    const rescueId = await adapter.withSessionGate(id, () =>
      adapter.rescue("rewind-original", id, before.revision),
    );
    const request = {
      operationId: "rewind-original",
      sessionId: id,
      userBlockId: "remove",
      direction: "rewind" as const,
      expectedRevision: before.revision,
    };
    const receipt = await adapter.withSessionGate(id, () => adapter.restore(request));
    expect(receipt.revision).toBe(before.revision + 1);
    const rewound = await store.session(id);
    expect(rewound.session.blocks.map((block) => block.id)).toEqual(["retained"]);
    expect(rewound.session.providerSessionId).toBeUndefined();
    expect(rewound.session.pendingContextReplay).toContain("retained context");
    expect(rewound.session.rewindHistory?.at(-1)?.id).toBe("rewind-original");
    expect(await adapter.restore(request)).toEqual(receipt);
    expect(await engine.conversationRewindAdapter().receipt("rewind-original")).toEqual(receipt);
    expect((await store.session(id)).revision).toBe(receipt.revision);
    await expect(adapter.restore({ ...request, userBlockId: "retained" })).rejects.toThrow(
      "different payload",
    );
    await adapter.withSessionGate(id, () =>
      adapter.restore({
        operationId: "undo-original",
        sessionId: id,
        userBlockId: "remove",
        direction: "undo",
        transcriptRescueId: rescueId,
        expectedRevision: receipt.revision,
      }),
    );
    const undone = await store.session(id);
    expect(undone.session.blocks.map((block) => block.id)).toEqual([
      "retained",
      "remove",
      "answer",
    ]);
    expect(undone.session.providerSessionId).toBeUndefined();
    expect(undone.session.pendingContextReplay).toContain("removed answer");
  });

  it("rolls back transcript mutation if its durable receipt cannot be written", async () => {
    const { engine, store, id } = await setup();
    const initial = await store.session(id);
    await store.save(
      {
        ...initial,
        revision: initial.revision + 1,
        session: {
          ...initial.session,
          blocks: [{ id: "remove", role: "user", text: "do not lose this" }],
        },
      },
      { type: "fixture" },
    );
    const before = await store.session(id);
    const adapter = engine.conversationRewindAdapter();
    await adapter.receipt("failed-atomic");
    const originalPrepare = store.db.prepare.bind(store.db);
    const spy = vi.spyOn(store.db, "prepare").mockImplementation((sql) => {
      const statement = originalPrepare(sql);
      if (sql.startsWith("INSERT INTO managed_rewind_receipts"))
        statement.run = async () => {
          throw new Error("receipt disk failure");
        };
      return statement;
    });
    await expect(
      adapter.restore({
        operationId: "failed-atomic",
        sessionId: id,
        userBlockId: "remove",
        direction: "rewind",
        expectedRevision: before.revision,
      }),
    ).rejects.toThrow("receipt disk failure");
    spy.mockRestore();
    expect(await store.session(id)).toEqual(before);
    expect(await adapter.receipt("failed-atomic")).toBeNull();
  });

  it("settles an owned provider but refuses unconfirmed background writers", async () => {
    const { engine, store, id, turns, waitForTurnStart } = await setup();
    await engine.command({
      type: "send",
      commandId: "settle-provider",
      sessionId: id,
      text: "work",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    const adapter = engine.conversationRewindAdapter();
    await adapter.settle(id);
    expect((await store.session(id)).status).toBe("idle");
    const latest = await store.session(id);
    await store.save(
      {
        ...latest,
        revision: latest.revision + 1,
        session: { ...latest.session, backgroundTasks: ["unconfirmed-writer"] },
      },
      { type: "fixture" },
    );
    await expect(adapter.settle(id)).rejects.toThrow("Settle background writers");
  });

  it("captures the accepted block before execution and the settled head afterward", async () => {
    const { adapter } = managedHistory();
    const { engine, store, id, provider, turns, waitForTurnStart } = await setup(
      "codex",
      {},
      adapter,
    );
    vi.mocked(adapter.history.begin).mockImplementationOnce(async (request) => {
      expect(provider.send).not.toHaveBeenCalled();
      expect(request.userBlockId).toBe("accepted-boundary");
      expect((await store.session(id)).session.blocks.at(-1)?.id).toBe(request.userBlockId);
      return {
        ...request,
        branchRef: "refs/heads/bycoda/s/test",
        before: {
          status: "complete",
          snapshot: {
            head: "a",
            index: "b",
            worktree: "c",
            indexMetadataId: "metadata",
            paths: [],
            capturedAt: 1,
          },
        },
      };
    });
    vi.mocked(adapter.history.end).mockImplementationOnce(async (request) => ({
      ...request,
      conversationRevision: 1,
      branchRef: "refs/heads/bycoda/s/test",
      before: { status: "blocked", reason: "fixture" },
      after: {
        status: "complete",
        snapshot: {
          head: "a",
          index: "b",
          worktree: "c",
          indexMetadataId: "metadata",
          paths: [],
          capturedAt: 1,
        },
      },
    }));
    const legacyBegin = vi.spyOn(engine.checkpoints, "begin");
    const receipt = await engine.command({
      type: "send",
      commandId: "accepted-boundary",
      sessionId: id,
      text: "change source",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    expect(adapter.history.end).not.toHaveBeenCalled();
    expect(legacyBegin).not.toHaveBeenCalled();
    turns[0].finish();
    await engine.waitForRun(id, receipt.runId);
    expect((await store.session(id)).status).toBe("idle");
    expect(adapter.history.end).toHaveBeenCalledWith(
      expect.objectContaining({ userBlockId: "accepted-boundary", sessionId: id }),
    );
  });

  it("stops managed dispatch and surfaces the reason when before capture is blocked", async () => {
    const { adapter } = managedHistory();
    vi.mocked(adapter.history.begin).mockImplementation(async (request) => ({
      ...request,
      branchRef: "refs/heads/bycoda/s/test",
      before: { status: "blocked", reason: "Resolve the unmerged index" },
    }));
    const { engine, store, id, provider } = await setup("codex", {}, adapter);
    const legacyFinish = vi.spyOn(engine.checkpoints, "finish");
    await engine.command({
      type: "send",
      commandId: "blocked-capture",
      sessionId: id,
      text: "change",
    });
    await vi.waitFor(async () => expect((await store.session(id)).status).toBe("idle"));
    expect(provider.send).not.toHaveBeenCalled();
    expect(legacyFinish).not.toHaveBeenCalled();
    expect(adapter.history.end).not.toHaveBeenCalled();
    expect(JSON.stringify((await store.session(id)).session.blocks)).toContain(
      "Resolve the unmerged index",
    );
  });

  it("fences new writes before accepting a command while recovery is pending", async () => {
    const { adapter } = managedHistory();
    const { engine, store, id, provider } = await setup("codex", {}, adapter);
    const before = await store.session(id);
    vi.mocked(adapter.assertWritable).mockRejectedValue(new Error("Rewind recovery pending"));
    await expect(
      engine.command({ type: "send", commandId: "blocked-write", sessionId: id, text: "change" }),
    ).rejects.toThrow("Rewind recovery pending");
    expect(await store.session(id)).toEqual(before);
    expect(provider.send).not.toHaveBeenCalled();
    expect(await engine.busyReason(id)).toBe("Rewind recovery pending");
  });

  it("requires a host Git preview before a managed rewind and never calls provider revert", async () => {
    const { adapter } = managedHistory();
    const { engine, store, id, provider } = await setup("codex", {}, adapter);
    provider.rewind = vi.fn(async () => {});
    const before = await store.session(id);
    await expect(
      engine.rewind({
        type: "rewind",
        commandId: "unsafe-rewind",
        sessionId: id,
        blockId: "anything",
      }),
    ).rejects.toThrow("sessions.rewind.plan/apply");
    expect(provider.rewind).not.toHaveBeenCalled();
    expect(await store.session(id)).toEqual(before);
  });

  it("keeps previous boundaries through compaction and captures compaction separately", async () => {
    const { adapter, records } = managedHistory();
    const { engine, store, id, provider, turns, waitForTurnStart } = await setup(
      "codex",
      {},
      adapter,
    );
    const firstRunReceipt = await engine.command({
      type: "send",
      commandId: "before-compact",
      sessionId: id,
      text: "first",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    turns[0].finish();
    await engine.waitForRun(id, firstRunReceipt.runId);
    expect((await store.session(id)).status).toBe("idle");
    let compactStarted!: () => void;
    const compactStart = new Promise<void>((resolve) => {
      compactStarted = resolve;
    });
    provider.compact = vi.fn(async () => {
      compactStarted();
    });
    const secondRunReceipt = await engine.command({
      type: "compact",
      commandId: "compact-boundary",
      sessionId: id,
    });
    await compactStart;
    await engine.waitForRun(id, secondRunReceipt.runId);
    expect((await store.session(id)).status).toBe("idle");
    expect([...records.keys()]).toEqual(["before-compact", "compact-boundary"]);
    expect(records.get("before-compact")?.before.status).toBe("complete");
    expect(records.get("compact-boundary")?.after?.status).toBe("complete");
    expect((await engine.conversationRewindAdapter().read(id)).userBlockIds).toEqual([
      "before-compact",
      "compact-boundary",
    ]);
  });
});

describe("handoff context capacity", () => {
  async function seedHandoff(contextWindow?: number) {
    const result = await setup("codex");
    if (contextWindow !== undefined) {
      setHarnessModels("codex", [
        {
          id: "codex:test",
          harness: "codex",
          name: "Discovered model",
          contextWindow,
        },
      ]);
      cleanups.push(resetHarnessModelOverlays);
    }
    const original = await result.store.session(result.id);
    await result.store.save(
      {
        ...original,
        revision: original.revision + 1,
        session: appendReadyHandoff(
          {
            ...original.session,
            providerSessionId: "outgoing-thread",
            blocks: [
              { id: "original", role: "user", text: "Preserve the original decisions." },
              { id: "oversized", role: "assistant", text: "Previous history. ".repeat(10_000) },
            ],
          },
          "codex",
          "codex",
          "Continue the saved conversation.",
        ),
      },
      { type: "test.handoff" },
    );
    return result;
  }

  it("sends a long Turkish request with an unknown window and reduced history", async () => {
    const { engine, store, turns, id, waitForTurnStart } = await seedHandoff();
    const text = "Türkçe isteği değiştirmeden gönder. ".repeat(1000);
    expect(Buffer.byteLength(text)).toBeGreaterThan(20_000);
    await expect(
      engine.command({
        type: "send",
        commandId: "long-turkish",
        sessionId: id,
        text,
      }),
    ).resolves.toBeDefined();
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    expect(turns[0].input.text).toContain(text);
    expect(turns[0].input.text).toContain("handoff-history");
    expect(turns[0].input.text).not.toContain("Previous history. ".repeat(10_000));
    const session = (await store.session(id)).session;
    expect(session.blocks.find((block) => block.id === "long-turkish")?.text).toBe(text);
    expect(session.blocks.find((block) => block.handoff)?.handoff?.pending).toBe(false);
    turns[0].finish();
  });

  it("uses a tiny discovered window, persists a non-blocking notice, and resets the old thread", async () => {
    const { engine, store, provider, turns, id, directory, waitForTurnStart } =
      await seedHandoff(32);
    await expect(
      engine.command({
        type: "send",
        commandId: "tiny-capacity",
        sessionId: id,
        text: "Continue the work.",
      }),
    ).resolves.toBeDefined();
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    expect(turns[0].input.text).toBe("Continue the work.");
    expect(provider.stop).toHaveBeenCalledWith(id);
    const session = (await store.session(id)).session;
    const notice = session.blocks.find((block) => block.notice === "info");
    expect(notice).toBeDefined();
    expect(isNoticeBlock(notice!)).toBe(true);
    expect(notice!.text).toContain("handoff-history");
    expect(notice!.text).not.toContain("Previous history.");
    const archive = await new HandoffHistoryStore(directory).read(id);
    expect(archive.messages.map((message) => message.id)).toEqual(["original", "oversized"]);
    expect(session.blocks.find((block) => block.handoff)?.handoff?.pending).toBe(false);
    turns[0].finish();
  });

  it("budgets expanded skill policy once and sends the prepared request without re-expansion", async () => {
    const text = "/fixture Continue.";
    const expanded = `Injected skill policy. ${"policy ".repeat(2000)}\n${text}`;
    const skill = vi.spyOn(skillPrompts, "prepareHostSkillPrompt").mockResolvedValue(expanded);
    cleanups.push(() => skill.mockRestore());
    const { engine, store, turns, id, waitForTurnStart } = await seedHandoff(1024);
    await engine.command({ type: "send", commandId: "skill-accounting", sessionId: id, text });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    expect(skill).toHaveBeenCalledTimes(1);
    expect(turns[0].input.text).toBe(expanded);
    const session = (await store.session(id)).session;
    expect(session.blocks.find((block) => block.id === "skill-accounting")?.text).toBe(text);
    expect(session.blocks.some((block) => block.notice === "info")).toBe(true);
    turns[0].finish();
  });

  it("budgets real machine restrictions at the final provider boundary without duplicating them", async () => {
    const { engine, store, provider, turns, id, waitForTurnStart } = await seedHandoff(2048);
    const policy = {
      disabledNames: Array.from({ length: 200 }, (_, i) => `disabled-skill-${i}`),
      disabledPaths: Array.from({ length: 200 }, (_, i) => `C:/skills/disabled-${i}/SKILL.md`),
    };
    // Use the production enforcement wrapper around the fake provider transport.
    Object.assign(
      provider,
      withMachineSkillPolicy("codex", { ...provider }, () => policy, () => []),
    );
    await engine.command({
      type: "send",
      commandId: "machine-policy-budget",
      sessionId: id,
      text: "Continue.",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    expect(turns[0].input.text).toBe("Continue.");
    expect(turns[0].input.skillPolicy).toEqual(policy);
    const instructions = turns[0].input.runtimeInstructions!;
    expect(instructions.match(/Disabled skill names:/g)).toHaveLength(1);
    expect(instructions.match(/Disabled skill paths:/g)).toHaveLength(1);
    expect(instructions).toContain("disabled-skill-199");
    expect(instructions).toContain("C:/skills/disabled-199/SKILL.md");
    const session = (await store.session(id)).session;
    expect(session.blocks.some((block) => block.notice === "info")).toBe(true);
    expect(session.blocks.find((block) => block.id === "machine-policy-budget")?.text).toBe(
      "Continue.",
    );
    turns[0].finish();
  });

  it("charges injected runtime instructions once and keeps them out of the owner's transcript", async () => {
    const hint = "Runtime skill policy. ".repeat(1000);
    const hints = vi.spyOn(runtimeGuidance, "harnessRuntimeHints").mockResolvedValue(hint);
    cleanups.push(() => hints.mockRestore());
    const { engine, store, turns, id, waitForTurnStart } = await seedHandoff(1024);
    await engine.command({
      type: "send",
      commandId: "runtime-accounting",
      sessionId: id,
      text: "Continue.",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    expect(turns[0].input.text).toBe("Continue.");
    expect(turns[0].input.runtimeInstructions).toBe(hint);
    const session = (await store.session(id)).session;
    expect(session.blocks.find((block) => block.id === "runtime-accounting")?.text).toBe(
      "Continue.",
    );
    expect(session.blocks.some((block) => block.notice === "info")).toBe(true);
    turns[0].finish();
  });
});

describe("headless session ownership", () => {
  it("rejects explicit foreign models at creation and configuration without changing the conversation", async () => {
    const { engine, store, project, provider, id } = await setup("codex");
    const before = await store.session(id);
    await expect(
      engine.command({
        type: "create",
        commandId: "foreign-create",
        projectId: project.id,
        harness: "codex",
        model: "antigravity:gemini-3.8-flash-high",
        runtimeMode: "supervised",
      }),
    ).rejects.toThrow("does not belong to provider");
    await expect(
      engine.command({
        type: "configure",
        commandId: "foreign-configure",
        sessionId: id,
        harness: "codex",
        model: "antigravity:gemini-3.8-flash-high",
        modelSettings: {},
        runtimeMode: "supervised",
      }),
    ).rejects.toThrow("does not belong to provider");
    expect(await store.session(id)).toEqual(before);
    expect(await store.sessions()).toHaveLength(1);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it.each(["send", "compact"] as const)(
    "refuses a stored mixed identity before %s consumes context or calls a provider",
    async (type) => {
      const { engine, store, provider, id } = await setup("codex");
      provider.compact = vi.fn(async () => {});
      const original = await store.session(id);
      const corrupted = await store.save(
        {
          ...original,
          revision: original.revision + 1,
          session: {
            ...original.session,
            model: "antigravity:gemini-3.8-flash-high",
            pendingContextReplay: "Earlier request must be retained",
            pendingSwitch: { from: "codex", fromModel: "codex:test", fromSettings: {} },
            blocks: [{ id: "earlier", role: "user", text: "Earlier request must be retained" }],
          },
        },
        { type: "test.corrupt-model" },
      );
      await expect(
        engine.command({
          type,
          commandId: `foreign-${type}`,
          sessionId: id,
          ...(type === "send" ? { text: "Continue" } : {}),
        }),
      ).rejects.toThrow("does not belong to provider");
      expect(await store.session(id)).toEqual(corrupted);
      expect(provider.send).not.toHaveBeenCalled();
      expect(provider.compact).not.toHaveBeenCalled();
    },
  );

  it("rejects an accepted desktop snapshot with a foreign model without copying a mixed identity", async () => {
    const { engine, store, provider, id } = await setup("codex");
    const original = await store.session(id);
    const before = await store.save(
      {
        ...original,
        revision: original.revision + 1,
        desktop: { updatedAt: 1, revision: original.revision + 1 },
      },
      { type: "test.desktop" },
    );
    const snapshot = structuredClone(before);
    snapshot.updatedAt = before.updatedAt + 1000;
    snapshot.session.model = "antigravity:gemini-3.8-flash-high";
    await expect(engine.refreshFromDesktop(snapshot)).rejects.toThrow(
      "does not belong to provider",
    );
    expect(await store.session(id)).toEqual(before);
    expect(provider.bind).not.toHaveBeenCalled();
  });

  it("dispatches a Codex to Gemini handoff only through the Gemini adapter with its selected model", async () => {
    let targetStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      targetStarted = resolve;
    });
    const target: HostProvider = {
      send: vi.fn(async () => {
        targetStarted();
      }),
      cancel: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      bind: vi.fn(),
      approve: vi.fn(),
      answer: vi.fn(),
    };
    const { engine, store, provider, id } = await setup("codex", { antigravity: target });
    const original = await store.session(id);
    await store.save(
      {
        ...original,
        revision: original.revision + 1,
        session: {
          ...original.session,
          providerSessionId: "codex-native-thread",
          blocks: [
            { id: "original-request", role: "user", text: "Keep project marker SKY-7421" },
            { id: "original-answer", role: "assistant", text: "Keep the original parser contract" },
          ],
        },
      },
      { type: "test.history" },
    );
    await engine.command({
      type: "configure",
      commandId: "gemini-choice",
      sessionId: id,
      harness: "antigravity",
      model: "antigravity:gemini-3.8-flash-high",
      modelSettings: {},
      runtimeMode: "supervised",
    });
    await engine.command({
      type: "send",
      commandId: "gemini-send",
      sessionId: id,
      text: "Continue the earlier work",
    });
    await started;
    expect(target.send).toHaveBeenCalledTimes(1);
    const input = vi.mocked(target.send).mock.calls[0][0];
    expect(input.model).toBe("antigravity:gemini-3.8-flash-high");
    expect(input.sessionId).toBe(id);
    expect(input.text).toContain("SKY-7421");
    expect(input.text).toContain("original parser contract");
    expect(provider.send).not.toHaveBeenCalled();
    expect(target.bind).not.toHaveBeenCalled();
    const final = await store.session(id);
    expect(final.session.blocks.slice(0, 2).map((block) => block.id)).toEqual([
      "original-request",
      "original-answer",
    ]);
    expect(await store.sessions()).toHaveLength(1);
  });

  it.each(REMOTE_PROVIDERS)(
    "rewinds durably and sends only retained context for %s",
    async (harness) => {
      const { engine, store, provider, turns, id, waitForTurnStart } = await setup(harness);
      const initial = await store.session(id);
      await store.save(
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
      const before = (await store.session(id)).revision;
      const rewind = {
        type: "rewind",
        commandId: "rewind-one",
        sessionId: id,
        blockId: "u2",
      };
      const receipt = await engine.rewind(rewind);
      expect(receipt.revision).toBe(before + 1);
      expect(provider.stop).toHaveBeenCalledWith(id);
      const saved = await store.session(id);
      expect(saved.session.blocks.map((block) => block.id)).toEqual(["u1", "a1"]);
      expect(saved.session.providerSessionId).toBeUndefined();
      expect(saved.session.rewindHistory).toHaveLength(1);
      expect(saved.session.pendingContextReplay).toContain("Keep this request");
      expect(saved.session.pendingContextReplay).toContain("Keep this answer");

      const sent = await engine.command({
        type: "send",
        commandId: "after-rewind",
        sessionId: id,
        text: "Continue",
      });
      await waitForTurnStart();
      expect(turns).toHaveLength(1);
      expect(turns[0].input.text).toContain("Keep this request");
      expect(turns[0].input.text).not.toContain("Remove this request");
      expect(turns[0].input.text).not.toContain("Remove this answer");
      expect((await store.session(id)).session.pendingContextReplay).toBeTruthy();
      turns[0].input.onAccepted?.();
      expect((await store.session(id)).session.pendingContextReplay).toBeUndefined();
      turns[0].finish();
      await engine.waitForRun(id, sent.runId);
      expect((await store.session(id)).status).toBe("idle");
    },
  );

  it("uses native rewind for the latest editable Codex turn and preserves the resulting provider binding", async () => {
    const { engine, store, provider, id } = await setup();
    const { adapter } = managedHistory();
    adapter.workspaceForSession = async () => null;
    engine.setManagedTurnHistoryAdapter(adapter);
    provider.rewind = vi.fn(async (input) => {
      input.onEvent({ type: "session.providerBound", providerSessionId: "forked-thread" });
      return { submitted: false };
    });
    const initial = await store.session(id);
    await store.save(
      {
        ...initial,
        revision: initial.revision + 1,
        session: {
          ...initial.session,
          providerSessionId: "provider-thread",
          blocks: [
            { id: "prior", role: "user", text: "Earlier turn", providerTurnId: "turn-1" },
            {
              id: "latest-a",
              role: "user",
              text: "First grouped message",
              providerTurnId: "turn-2",
            },
            {
              id: "latest-b",
              role: "user",
              text: "Last grouped message",
              providerTurnId: "turn-2",
            },
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
    expect(provider.rewind).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: id,
        providerTurnId: "turn-2",
      }),
    );
    expect(provider.stop).not.toHaveBeenCalled();
    expect((await store.session(id)).session.blocks.map((block) => block.id)).toEqual(["prior"]);
    expect((await store.session(id)).session.providerSessionId).toBe("forked-thread");
    expect((await store.session(id)).session.pendingContextReplay).toBeUndefined();
  });

  it("keeps the visible transcript when a native rewind commits unsuccessfully and prepares fresh replay", async () => {
    const { engine, store, provider, turns, id, waitForTurnStart } = await setup();
    const { adapter } = managedHistory();
    adapter.workspaceForSession = async () => null;
    engine.setManagedTurnHistoryAdapter(adapter);
    provider.rewind = vi.fn(async () => ({ submitted: false }));
    const initial = await store.session(id);
    await store.save(
      {
        ...initial,
        revision: initial.revision + 1,
        session: {
          ...initial.session,
          providerSessionId: "provider-thread",
          blocks: [
            { id: "prior", role: "user", text: "Retain this request", providerTurnId: "turn-1" },
            {
              id: "latest",
              role: "user",
              text: "This must remain visible",
              providerTurnId: "turn-2",
            },
          ],
        },
      },
      { type: "test.seed" },
    );
    const before = await store.session(id);
    let recovering = false;
    let edit: ReturnType<HostEngine["updateSession"]> | undefined;
    const read = store.session.bind(store);
    const recoveryRead = vi.spyOn(store, "session").mockImplementation(async (sessionId) => {
      const value = await read(sessionId);
      if (recovering && !edit) {
        edit = store.db.outsideScope(() =>
          engine.updateSession(id, { title: "Accepted during recovery", pinned: true }),
        );
      }
      return value;
    });
    const failFirstSave = vi.spyOn(store, "save").mockImplementationOnce(() => {
      recovering = true;
      throw new Error("disk full");
    });

    await expect(
      engine.rewind({
        type: "rewind",
        commandId: "native-commit-failure",
        sessionId: id,
        blockId: "latest",
      }),
    ).rejects.toThrow("disk full");

    expect(edit).toBeDefined();
    await edit;
    const recovered = await store.session(id);
    expect(recovered.session.title).toBe("Accepted during recovery");
    expect(recovered.pinned).toBe(true);
    expect(recovered.session.blocks).toEqual(before.session.blocks);
    expect(recovered.session.rewindHistory).toEqual(before.session.rewindHistory);
    expect(recovered.session.providerSessionId).toBeUndefined();
    expect(recovered.session.pendingContextReplay).toContain("Retain this request");
    expect(provider.stop).toHaveBeenCalledWith(id);
    failFirstSave.mockRestore();
    recoveryRead.mockRestore();

    await engine.command({
      type: "send",
      commandId: "fresh-after-native-error",
      sessionId: id,
      text: "Continue",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    expect(turns[0].input.text).toContain("Retain this request");
    expect(turns[0].input.text).toContain("This must remain visible");
  });

  it("rejects competing host commands while provider cleanup for rewind is pending", async () => {
    const { engine, store, provider, id } = await setup();
    const initial = await store.session(id);
    await store.save(
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
    provider.stop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishStop = resolve;
        }),
    );
    const rewinding = engine.rewind({
      type: "rewind",
      commandId: "locked-rewind",
      sessionId: id,
      blockId: "removed",
    });
    await vi.waitFor(() => expect(provider.stop).toHaveBeenCalledOnce());
    await expect(
      engine.command({
        type: "send",
        commandId: "blocked-send",
        sessionId: id,
        text: "must wait",
      }),
    ).rejects.toThrow("conversation change is in progress");
    finishStop();
    await expect(rewinding).resolves.toMatchObject({ commandId: "locked-rewind" });
  });

  it("rejects a rewind against a stale remote session revision before provider mutation", async () => {
    const { engine, store, provider, id } = await setup();
    provider.rewind = vi.fn(async () => ({ submitted: false }));
    const initial = await store.session(id);
    const staleRevision = initial.revision;
    await store.save(
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
    await expect(
      engine.rewind({
        type: "rewind",
        commandId: "stale-rewind",
        sessionId: id,
        blockId: "latest",
        expectedRevision: staleRevision,
      }),
    ).rejects.toThrow("changed; refresh");
    expect(provider.rewind).not.toHaveBeenCalled();
    expect(provider.stop).not.toHaveBeenCalled();
    expect((await store.session(id)).session.blocks.map((block) => block.id)).toEqual([
      "kept",
      "latest",
    ]);
  });

  it("applies host skill instructions while retaining the original user transcript", async () => {
    const { engine, store, turns, id, directory, waitForTurnStart } = await setup("claude");
    const folder = join(directory, ".agents/skills/remote-review");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "SKILL.md"), "Use the host review checklist");
    await engine.command({
      type: "send",
      commandId: "remote-skill",
      sessionId: id,
      text: "/remote-review inspect",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    expect(turns[0].input.text).toContain("Use the host review checklist");
    expect(
      (await store.session(id)).session.blocks.find((block) => block.role === "user")?.text,
    ).toBe("/remote-review inspect");
  });
  it.each(["earlier text", "earlier metadata", "tail text", "tail metadata", "append", "remove"])(
    "refreshes %s even with equal revisions",
    async (change) => {
      const { engine, store, id } = await setup("claude");
      const base = await store.session(id);
      const adopted = await store.save(
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
      if (change === "append")
        snapshot.session.blocks.push({ id: "u2", role: "user", text: "Next" });
      if (change === "remove") snapshot.session.blocks.pop();
      expect(snapshot.revision).toBe(adopted.revision);
      const refreshed = (await engine.refreshFromDesktop(snapshot))!;
      expect(refreshed.session.blocks).toEqual(snapshot.session.blocks);
      expect(refreshed.session.blocks).not.toEqual(adopted.session.blocks);
    },
  );

  it("refreshes a desktop provider switch atomically and binds the new thread only to its adapter", async () => {
    const target: HostProvider = {
      send: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      bind: vi.fn(),
      approve: vi.fn(),
      answer: vi.fn(),
    };
    const { engine, store, id, provider } = await setup("claude", { codex: target });
    const initial = await store.session(id);
    const adopted = await store.save(
      {
        ...initial,
        revision: initial.revision + 1,
        desktop: { updatedAt: 1, revision: initial.revision + 1 },
        session: {
          ...initial.session,
          providerSessionId: "claude-thread",
          blocks: [{ id: "original", role: "user", text: "Remember the original request" }],
        },
      },
      { type: "test.adopted" },
    );
    const snapshot = structuredClone(adopted);
    snapshot.updatedAt = adopted.updatedAt + 1000;
    snapshot.session = {
      ...snapshot.session,
      harness: "codex",
      model: "codex:new",
      modelSettings: { reasoningEffort: "high" },
      providerSessionId: "codex-thread",
      providerAccountId: "work",
      pendingContextReplay: "Retained conversation context",
    };
    const refreshed = (await engine.refreshFromDesktop(snapshot))!;
    expect(refreshed.session).toMatchObject(snapshot.session);
    expect(refreshed.session.id).toBe(id);
    expect(refreshed.session.blocks).toEqual(adopted.session.blocks);
    expect(provider.stop).toHaveBeenCalledWith(id);
    expect(provider.bind).not.toHaveBeenCalled();
    expect(target.bind).toHaveBeenCalledWith(id, "codex-thread", initial.session.cwd, "work");
  });

  it("continues the same adopted chat with retained context after a desktop provider switch", async () => {
    const { engine, store, id, turns, provider, waitForTurnStart } = await setup("claude");
    const initial = await store.session(id);
    const adopted = await store.save(
      {
        ...initial,
        revision: initial.revision + 1,
        desktop: { updatedAt: 1, revision: initial.revision + 1 },
        session: {
          ...initial.session,
          providerSessionId: "claude-thread",
          blocks: [
            { id: "original", role: "user", text: "Remember the original request" },
            { id: "answer", role: "assistant", text: "The earlier answer" },
          ],
        },
      },
      { type: "test.adopted" },
    );
    const snapshot = structuredClone(adopted);
    snapshot.updatedAt = adopted.updatedAt + 1000;
    snapshot.session.harness = "codex";
    snapshot.session.model = "codex:new";
    snapshot.session.providerSessionId = undefined;
    snapshot.session.pendingContextReplay =
      "USER: Remember the original request\nASSISTANT: The earlier answer";
    const refreshed = (await engine.refreshFromDesktop(snapshot))!;
    expect(mergeAdoptedSession(snapshot.session, refreshed, adopted.session)).toMatchObject({
      id,
      harness: "codex",
      model: "codex:new",
      blocks: adopted.session.blocks,
    });
    expect(provider.stop).toHaveBeenCalledWith(id);
    expect(provider.bind).not.toHaveBeenCalled();
    await engine.command({
      type: "send",
      commandId: "continue-switched",
      sessionId: id,
      text: "Continue",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    expect(turns[0].input.model).toBe("codex:new");
    expect(turns[0].input.text).toContain("Remember the original request");
    expect(turns[0].input.text).toContain("The earlier answer");
    const continued = await store.session(id);
    expect(continued.session.id).toBe(id);
    expect(continued.session.blocks.slice(0, 2)).toEqual(adopted.session.blocks);
    turns[0].finish();
  });

  it.each(["settings", "account", "runtime", "replay"])(
    "refreshes desktop %s changes even when the transcript and model are unchanged",
    async (change) => {
      const { engine, store, id } = await setup();
      const initial = await store.session(id);
      const adopted = await store.save(
        {
          ...initial,
          revision: initial.revision + 1,
          desktop: { updatedAt: 1, revision: initial.revision + 1 },
        },
        { type: "test.adopted" },
      );
      const snapshot = structuredClone(adopted);
      snapshot.updatedAt = adopted.updatedAt + 1000;
      if (change === "settings") snapshot.session.modelSettings = { reasoningEffort: "high" };
      if (change === "account") snapshot.session.providerAccountId = "work";
      if (change === "runtime") snapshot.session.runtimeMode = "full-access";
      if (change === "replay")
        snapshot.session.pendingContextReplay = "Remember the earlier discussion";
      const refreshed = (await engine.refreshFromDesktop(snapshot))!;
      expect(refreshed.session).toEqual(snapshot.session);
    },
  );

  it("recognizes identical blocks with unrelated desktop revisions and no block revision metadata", async () => {
    const { engine, store, id } = await setup("claude");
    const base = await store.session(id);
    const adopted = await store.save(
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
    expect((await engine.refreshFromDesktop(snapshot))?.session.blocks).toEqual(
      adopted.session.blocks,
    );
    expect(save.mock.calls.at(-1)?.[1]).toEqual({ type: "desktopSeen" });
  });

  it("keeps a turn's output over a desktop copy saved before it ended", async () => {
    const { engine, store, turns, id, waitForTurnStart } = await setup("claude");
    const runReceipt = await engine.command({
      type: "send",
      commandId: "send",
      sessionId: id,
      text: "Review it",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    // The desktop mirrors the session while the turn is still running.
    const midTurn = structuredClone(await store.session(id));
    midTurn.updatedAt = Date.now();
    midTurn.status = "idle";
    await new Promise((resolve) => setTimeout(resolve, 5));
    turns[0].input.onEvent({ type: "message.delta", text: "VERDICT: PASS" });
    turns[0].input.onEvent({ type: "message.completed" });
    turns[0].finish();
    await engine.waitForRun(id, runReceipt.runId);
    expect((await store.session(id)).status).toBe("idle");

    await engine.refreshFromDesktop(midTurn);
    const reply = (blocks: { role: string; text: string }[]) =>
      blocks.find((block) => block.role === "assistant")?.text;
    expect(reply((await store.session(id)).session.blocks)).toBe("VERDICT: PASS");

    // A newer desktop copy that never mirrored the host turn cannot erase it.
    const missing = structuredClone(await store.session(id));
    missing.updatedAt = Date.now() + 1000;
    missing.session.blocks = missing.session.blocks.filter((block) => block.role === "user");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await engine.refreshFromDesktop(missing);
    expect(reply((await store.session(id)).session.blocks)).toBe("VERDICT: PASS");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("is behind it"));
    warn.mockRestore();

    // A turn the desktop ran later, after the host turn, still catches up.
    const later = structuredClone(await store.session(id));
    later.updatedAt = Date.now() + 2000;
    later.session.blocks.push(
      { id: "desk-user", role: "user", text: "Continue here" },
      { id: "desk-reply", role: "assistant", text: "Continued on the desktop" },
    );
    await engine.refreshFromDesktop(later);
    expect((await store.session(id)).session.blocks.at(-1)?.text).toBe("Continued on the desktop");
    expect((await store.session(id)).desktop?.revision).toBe((await store.session(id)).revision);
  });

  it("keeps a host turn when a newer desktop copy diverged, and accepts edits once matched", async () => {
    const { engine, store, id } = await setup("claude");
    const base = await store.session(id);
    const adopted = await store.save(
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
    await engine.refreshFromDesktop(rewound);
    expect((await store.session(id)).session.blocks.map((block) => block.id)).toEqual(["u1"]);

    // A remote message ran here, then the desktop ran a different turn.
    const hosted = await store.session(id);
    await store.save(
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
    const diverged = structuredClone(await store.session(id));
    diverged.updatedAt = Date.now() + 2000;
    diverged.session.blocks = [
      { id: "u1", role: "user", text: "Start" },
      { id: "desk", role: "user", text: "From the desktop" },
    ];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await engine.refreshFromDesktop(diverged);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("diverged"));
    warn.mockRestore();
    expect((await store.session(id)).session.blocks.map((block) => block.id)).toEqual([
      "u1",
      "phone",
      "writer",
    ]);

    // The desktop mirrored the phone message and continued past the failure.
    const continued = structuredClone(await store.session(id));
    continued.updatedAt = Date.now() + 3000;
    continued.session.blocks = [
      { id: "u1", role: "user", text: "Start" },
      { id: "phone", role: "user", text: "From the phone" },
      { id: "desk-2", role: "user", text: "Try again" },
    ];
    await engine.refreshFromDesktop(continued);
    expect((await store.session(id)).session.blocks.map((block) => block.id)).toEqual([
      "u1",
      "phone",
      "desk-2",
    ]);
  });

  it("keeps a failure the lagging desktop has not mirrored, and accepts continuations past shared ones", async () => {
    const { engine, store, id } = await setup("claude");
    const base = await store.session(id);
    const failure = {
      id: "writer",
      role: "system" as const,
      notice: "error" as const,
      text: "thread t already has an active writer",
    };
    await store.save(
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
    const lagging = structuredClone(await store.session(id));
    lagging.updatedAt = Date.now() + 1000;
    lagging.session.blocks = [{ id: "phone", role: "user", text: "From the phone" }];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await engine.refreshFromDesktop(lagging);
    warn.mockRestore();
    expect((await store.session(id)).session.blocks.at(-1)?.id).toBe("writer");
    expect(sessionIssue((await store.session(id)).session)).toBe("failed");

    // Both sides hold the old failure; the host then ran a turn the desktop
    // mirrored and continued.
    const hosted = await store.session(id);
    await store.save(
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
    const continued = structuredClone(await store.session(id));
    continued.updatedAt = Date.now() + 2000;
    continued.session.blocks.push({ id: "desk", role: "user", text: "Thanks" });
    await engine.refreshFromDesktop(continued);
    expect((await store.session(id)).session.blocks.map((block) => block.id)).toEqual([
      "phone",
      "writer",
      "retry",
      "answer",
      "desk",
    ]);
  });

  it("accepts a desktop turn past a message whose attachment the desktop stored without a path", async () => {
    const { engine, store, id } = await setup("claude");
    const base = await store.session(id);
    const file = {
      id: "f1",
      name: "a.png",
      mimeType: "image/png",
      kind: "image" as const,
      size: 1,
    };
    const sent = (path?: string) => ({
      id: "phone",
      role: "user" as const,
      text: "[image1]",
      attachments: [{ ...file, ...(path ? { path } : {}) }],
    });
    await store.save(
      {
        ...base,
        revision: base.revision + 1,
        desktop: { updatedAt: 1 },
        session: { ...base.session, blocks: [sent("C:/host/attachments/f1")] },
      },
      { type: "test.remote" },
    );
    const continued = structuredClone(await store.session(id));
    continued.updatedAt = Date.now() + 1000;
    continued.session.blocks = [sent(), { id: "desk", role: "user", text: "From the desktop" }];
    await engine.refreshFromDesktop(continued);
    expect((await store.session(id)).session.blocks.map((block) => block.id)).toEqual([
      "phone",
      "desk",
    ]);
  });

  describe("a persisted base decides which side changed", () => {
    const user = (id: string, text: string) => ({ id, role: "user" as const, text });
    const reply = (id: string, text: string) => ({ id, role: "assistant" as const, text });
    /** An adopted session whose host and desktop last agreed on `blocks`. */
    async function agreed(blocks: ReturnType<typeof user>[], mismatched = false) {
      const fixture = await setup("claude");
      const base = await fixture.store.session(fixture.id);
      const saved = await fixture.store.save(
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

    it("records the head both hold when the host adopts and when it takes the desktop's turns", async () => {
      const { engine, store, id, saved } = await agreed([user("u1", "Start"), reply("a1", "Done")]);
      expect((await store.session(id)).desktop?.base).toEqual(
        conversationHead(saved.session.blocks),
      );
      await engine.refreshFromDesktop(appended(saved, user("u2", "More")));
      const after = await store.session(id);
      expect(after.session.blocks.map((block) => block.id)).toEqual(["u1", "a1", "u2"]);
      expect(after.desktop?.base).toEqual(conversationHead(after.session.blocks));
    });

    it("takes a desktop rewind when the host has not moved since the base, whatever the revisions say", async () => {
      const { engine, store, id, saved } = await agreed(
        [user("u1", "Start"), reply("a1", "Done")],
        true,
      );
      const rewound = structuredClone(saved);
      rewound.updatedAt = Date.now() + 5_000;
      rewound.session.blocks = [user("u1", "Start")];
      await engine.refreshFromDesktop(rewound);
      expect((await store.session(id)).session.blocks.map((block) => block.id)).toEqual(["u1"]);
    });

    it("keeps its own turn and flags it when both sides appended after the same base", async () => {
      const { engine, store, id, saved } = await agreed([user("u1", "Start")], true);
      await store.save(
        {
          ...saved,
          revision: saved.revision + 1,
          session: { ...saved.session, blocks: [...saved.session.blocks, user("phone", "Phone")] },
        },
        { type: "test.remote" },
      );
      const save = vi.spyOn(store, "save");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await engine.refreshFromDesktop(appended(saved, user("desk", "Desktop")));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("diverged"));
      warn.mockRestore();
      expect(save.mock.calls.at(-1)?.[1]).toEqual({ type: "desktopDiverged" });
      expect((await store.session(id)).session.blocks.map((block) => block.id)).toEqual([
        "u1",
        "phone",
      ]);
      // The agreement is not moved by a conflict.
      expect((await store.session(id)).desktop?.base).toEqual(
        conversationHead([user("u1", "Start")]),
      );
    });

    it("keeps its own turn when the desktop only lags it", async () => {
      const { engine, store, id, saved } = await agreed([user("u1", "Start")], true);
      await store.save(
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
      await engine.refreshFromDesktop(lagging);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("is behind it"));
      warn.mockRestore();
      expect((await store.session(id)).session.blocks.map((block) => block.id)).toEqual([
        "u1",
        "phone",
      ]);
    });

    it("converges when the desktop keeps its version: its base names the host transcript it replaces", async () => {
      const { engine, store, id, saved } = await agreed([user("u1", "Start")], true);
      const hosted = await store.save(
        {
          ...saved,
          revision: saved.revision + 1,
          session: { ...saved.session, blocks: [...saved.session.blocks, user("phone", "Phone")] },
        },
        { type: "test.remote" },
      );
      const kept = appended(saved, user("desk", "Desktop"));
      kept.session.adoptedBase = conversationHead(hosted.session.blocks);
      await engine.refreshFromDesktop(kept);
      expect((await store.session(id)).session.blocks.map((block) => block.id)).toEqual([
        "u1",
        "desk",
      ]);
      expect((await store.session(id)).desktop?.base).toEqual(
        conversationHead((await store.session(id)).session.blocks),
      );
      // The host copy carries none of the desktop's own bookkeeping.
      expect((await store.session(id)).session).not.toHaveProperty("adoptedBase");
    });

    it("compares an adopted copy whose blocks carry files by their digests", async () => {
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
      const { engine, store, id, saved } = await agreed([sent("C:/host/files/f1")] as never, true);
      // The desktop stored the file elsewhere: the same message, one turn further.
      const continued = structuredClone(saved);
      continued.updatedAt = Date.now() + 5_000;
      continued.session.blocks = [sent("D:/desktop/f1"), user("desk", "Next")] as never;
      await engine.refreshFromDesktop(continued);
      expect((await store.session(id)).session.blocks.map((block) => block.id)).toEqual([
        "phone",
        "desk",
      ]);
    });
  });

  it("switches a historic chat between providers with context on the next send", async () => {
    const { engine, store, turns, id, waitForTurnStart } = await setup("claude");
    const value = await store.session(id);
    await store.save(
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
    await engine.command(change);
    expect((await store.session(id)).session).toMatchObject({
      harness: "codex",
      pendingSwitch: { from: "claude" },
    });
    expect((await store.session(id)).session.providerSessionId).toBeUndefined();
    expect(turns).toHaveLength(0);
    await engine.command({
      type: "send",
      commandId: "next",
      sessionId: id,
      text: "Continue the fix",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    expect(turns[0].input.text).toContain("Repair the model picker");
    expect(turns[0].input.text).toContain("Continue the fix");
    expect((await store.session(id)).session.blocks).toContainEqual(
      expect.objectContaining({
        role: "handoff",
        handoff: expect.objectContaining({
          from: "claude",
          to: "codex",
          pending: false,
        }),
      }),
    );
    expect((await store.session(id)).session.pendingSwitch).toBeUndefined();
    turns[0].finish();
  });

  it("restores the original provider conversation when a switch is reverted before sending", async () => {
    const { engine, store, provider, id } = await setup("claude");
    const value = await store.session(id);
    await store.save(
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
    await engine.command({
      ...change,
      commandId: "switch",
      harness: "codex",
      model: "codex:test",
    });
    await engine.command({
      ...change,
      commandId: "revert",
      harness: "claude",
      model: "claude:test",
    });
    expect((await store.session(id)).session).toMatchObject({
      harness: "claude",
      providerSessionId: "original",
    });
    expect((await store.session(id)).session.pendingSwitch).toBeUndefined();
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
      const { engine, store, turns, provider, id, waitForTurnStart } = await setup();
      provider.compact = (input) => provider.send({ ...input, text: "/compact" });
      await engine.command({
        type: "draft",
        commandId: "draft",
        sessionId: id,
        text: "Later",
      });
      await engine.command({
        type,
        commandId: "next",
        sessionId: id,
        text: "New work",
      });
      expect((await store.session(id)).session.blocks.some((block) => block.draft)).toBe(false);
      await waitForTurnStart();
      expect(turns).toHaveLength(1);
      turns[0].finish();
    },
  );

  it("contains a persistence failure while requesting approval", async () => {
    const { engine, store, turns, provider, id, waitForTurnStart } = await setup();
    const receipt = await engine.command({
      type: "send",
      commandId: "approval-failure",
      sessionId: id,
      text: "Work",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let settled!: () => void;
    const settledTurn = new Promise<void>((resolve) => {
      settled = resolve;
    });
    engine.onSettled = () => settled();
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
      await settledTurn;
      await engine.waitForRun(id, receipt.runId);
      expect((await store.session(id)).status).toBe("interrupted");
    } finally {
      log.mockRestore();
    }
  });

  it("stores a remote draft with an uploaded file, then sends it in plan mode", async () => {
    const { engine, store, turns, id, waitForTurnStart } = await setup();
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
    await engine.command({
      type: "draft",
      commandId: "draft-1",
      sessionId: id,
      text: "Plan this",
      attachments: [attachment],
    });
    expect((await store.session(id)).session.blocks[0]).toMatchObject({
      draft: true,
      attachments: [{ name: "notes.txt" }],
    });
    expect((await store.summaries((await store.session(id)).projectId))[0].draft).toBe(true);
    await engine.command({
      type: "send",
      commandId: "send-draft",
      sessionId: id,
      text: "Plan this",
      intent: "plan",
      draftBlockId: "draft-1",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    expect(turns[0].input).toMatchObject({
      intent: "plan",
      attachments: [{ name: "notes.txt", size: 5 }],
    });
    expect(turns[0].input.attachments?.[0].path).toContain(fileId);
    expect((await store.summaries((await store.session(id)).projectId))[0].draft).toBe(false);
    turns[0].finish();
  });

  it("passes an uploaded image to the host provider on an attachment-only turn", async () => {
    const { engine, store, turns, id, waitForTurnStart } = await setup("claude");
    const fileId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const image = Buffer.from("image-bytes");
    await writeAttachmentChunk(store, {
      id: fileId,
      offset: 0,
      size: image.length,
      data: image.toString("base64"),
    });
    await engine.command({
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
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    expect(turns[0].input.attachments?.[0]).toMatchObject({
      name: "shot.png",
      data: image.toString("base64"),
    });
    expect(await readAttachmentChunk(store, { sessionId: id, id: fileId, offset: 0 })).toEqual({
      offset: image.length,
      size: image.length,
      data: image.toString("base64"),
    });
    const other = await engine.command({
      type: "create",
      commandId: "other-session",
      projectId: (await store.session(id)).projectId,
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

  it("removes a remote draft without starting the provider", async () => {
    const { engine, store, provider, id } = await setup();
    await engine.command({
      type: "draft",
      commandId: "draft-2",
      sessionId: id,
      text: "Later",
    });
    await engine.command({
      type: "removeDraft",
      commandId: "remove-2",
      sessionId: id,
      draftBlockId: "draft-2",
    });
    expect((await store.session(id)).session.blocks).toEqual([]);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("marks a reviewed host plan as built after its build turn", async () => {
    const { engine, store, turns, id, waitForTurnStart } = await setup();
    const firstRunReceipt = await engine.command({
      type: "send",
      commandId: "plan-turn",
      sessionId: id,
      text: "Plan this",
      intent: "plan",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    turns[0].input.onEvent({ type: "plan", text: "# Steps\n\n1. Change code" });
    turns[0].finish();
    await engine.waitForRun(id, firstRunReceipt.runId);
    expect((await store.session(id)).status).toBe("idle");
    const plan = (await store.session(id)).session.blocks.find((block) => block.role === "plan")!;
    const secondRunReceipt = await engine.command({
      type: "send",
      commandId: "build-turn",
      sessionId: id,
      text: "Build a stale client copy of the plan",
      intent: "build",
      planBlockId: plan.id,
    });
    expect(
      (await store.session(id)).session.blocks.find((block) => block.id === plan.id)?.plan?.status,
    ).toBe("building");
    await waitForTurnStart(2);
    expect(turns).toHaveLength(2);
    expect(turns[1].input.text).toContain(`<approved_plan>\n${plan.text}\n</approved_plan>`);
    expect(turns[1].input.text).not.toContain("stale client copy");
    turns[1].finish();
    await engine.waitForRun(id, secondRunReceipt.runId);
    expect((await store.session(id)).status).toBe("idle");
    expect(
      (await store.session(id)).session.blocks.find((block) => block.id === plan.id)?.plan?.status,
    ).toBe("built");
  });

  it("requires an explicit pinned build for edited plan commands", () => {
    const command = {
      type: "send",
      commandId: "edited",
      sessionId: "s",
      text: "# Edited",
      intent: "build",
      planBlockId: "p",
      expectedPlanText: "# Original",
    };
    expect(parseCommand(command)).toMatchObject(command);
    for (const invalid of [
      { ...command, type: "draft" },
      { ...command, intent: "plan" },
      { ...command, planBlockId: undefined },
      { ...command, draftBlockId: "d" },
      { ...command, expectedPlanText: 42 },
      { ...command, expectedPlanText: "bad\0text" },
    ])
      expect(() => parseCommand(invalid)).toThrow();
  });

  it("builds exact edited plan text only against the reviewed base", async () => {
    const { engine, store, turns, id, waitForTurnStart } = await setup();
    const firstRunReceipt = await engine.command({
      type: "send",
      commandId: "review-plan",
      sessionId: id,
      text: "Plan this",
      intent: "plan",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    turns[0].input.onEvent({ type: "plan", text: "# Original\n1. First" });
    turns[0].finish();
    await engine.waitForRun(id, firstRunReceipt.runId);
    expect((await store.session(id)).status).toBe("idle");
    const plan = (await store.session(id)).session.blocks.find((block) => block.role === "plan")!;
    await expect(
      engine.command({
        type: "send",
        commandId: "stale-review",
        sessionId: id,
        text: "# Edited\n1. Second",
        intent: "build",
        planBlockId: plan.id,
        expectedPlanText: "stale",
      }),
    ).rejects.toThrow(/reviewed plan changed/);
    expect((await store.session(id)).status).toBe("idle");
    expect(turns).toHaveLength(1);
    const edited = "# Edited\n1. Second";
    const secondRunReceipt = await engine.command({
      type: "send",
      commandId: "build-reviewed",
      sessionId: id,
      text: edited,
      intent: "build",
      planBlockId: plan.id,
      expectedPlanText: plan.text,
    });
    await waitForTurnStart(2);
    expect(turns).toHaveLength(2);
    expect(turns[1].input.text).toContain(`<approved_plan>\n${edited}\n</approved_plan>`);
    expect(
      (await store.session(id)).session.blocks.find((block) => block.id === plan.id),
    ).toMatchObject({
      text: edited,
      plan: { status: "building", approvedText: edited, originalText: plan.text, edited: true },
    });
    turns[1].finish();
    await engine.waitForRun(id, secondRunReceipt.runId);
    expect((await store.session(id)).status).toBe("idle");
  });

  it("captures a text-only host plan and builds its exact stored text after explicit message approval", async () => {
    const { engine, store, turns, id, waitForTurnStart } = await setup();
    const firstRunReceipt = await engine.command({
      type: "send",
      commandId: "text-plan",
      sessionId: id,
      text: "Investigate search",
      intent: "plan",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    expect(turns[0].input.text).toContain("You are in plan mode");
    const text = "# Implementation plan\n\n1. Add search.\n2. Verify keyboard access.";
    turns[0].input.onEvent({ type: "message.delta", text });
    turns[0].finish();
    await engine.waitForRun(id, firstRunReceipt.runId);
    expect((await store.session(id)).status).toBe("idle");
    const plan = (await store.session(id)).session.blocks.find((block) => block.role === "plan")!;
    expect(plan?.text).toBe(text);
    const secondRunReceipt = await engine.command({
      type: "send",
      commandId: "approve-message",
      sessionId: id,
      text: "planı uygula",
    });
    await waitForTurnStart(2);
    expect(turns).toHaveLength(2);
    expect(turns[1].input.intent).toBe("build");
    expect(turns[1].input.text).toContain(`<approved_plan>\n${text}\n</approved_plan>`);
    expect(
      (await store.session(id)).session.blocks.find((block) => block.id === plan.id)?.plan,
    ).toMatchObject({ status: "building", approvedText: text });
    turns[1].finish();
    await engine.waitForRun(id, secondRunReceipt.runId);
    expect((await store.session(id)).status).toBe("idle");
    expect(
      (await store.session(id)).session.blocks.find((block) => block.id === plan.id)?.plan?.status,
    ).toBe("built");
  });

  it("keeps a manually renamed title when first-turn generation finishes later", async () => {
    const { engine, store, provider, turns, id, waitForTurnStart } = await setup();
    let finishTitle: (title: { title: string; workItem: null }) => void = () => {};
    provider.generateTitle = vi.fn(
      () =>
        new Promise((resolve) => {
          finishTitle = resolve;
        }),
    );
    const runReceipt = await engine.command({
      type: "send",
      commandId: "name-first-turn",
      sessionId: id,
      text: "Fix remote project titles",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    await engine.updateSession(id, { title: "codex · My own title" });
    finishTitle({ title: "Generated title", workItem: null });
    await vi.waitFor(() => expect(provider.generateTitle).toHaveBeenCalledTimes(1));
    turns[0].finish();
    await engine.waitForRun(id, runReceipt.runId);
    expect((await store.session(id)).status).toBe("idle");
    expect((await store.session(id)).session.title).toBe("codex · My own title");
  });

  it("uses one creation timestamp and advances only updatedAt on later commands", async () => {
    let now = 1_700_000_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now++);
    try {
      const { engine, store, project, id } = await setup();
      const initial = await store.session(id);
      const timestamps = {
        createdAt: initial.createdAt,
        updatedAt: initial.createdAt,
        revision: 1,
      };
      expect(initial).toMatchObject(timestamps);
      expect((await store.sessions(project.id))[0]).toMatchObject(timestamps);
      expect((await store.summaries(project.id))[0]).toMatchObject(timestamps);

      now = initial.updatedAt + 1_000;
      await engine.command({
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
      expect(await store.session(id)).toMatchObject(updatedTimestamps);
      expect((await store.sessions(project.id))[0]).toMatchObject(updatedTimestamps);
      expect((await store.summaries(project.id))[0]).toMatchObject(updatedTimestamps);
    } finally {
      clock.mockRestore();
    }
  });

  it("keeps remote card changes in host history and removes deleted sessions", async () => {
    const { store, project, id } = await setup();
    const initial = (await store.summaries(project.id))[0];
    expect(initial.model).toBe("codex:test");
    expect(initial.createdAt).toBe(initial.updatedAt);

    await store.save(
      {
        ...(await store.session(id)),
        revision: initial.revision + 1,
        updatedAt: initial.updatedAt + 1_000,
      },
      { type: "session.test" },
    );
    expect((await store.summaries(project.id))[0]).toMatchObject({
      createdAt: initial.createdAt,
      updatedAt: initial.updatedAt + 1_000,
    });

    const updated = await store.updateSession(id, {
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
    expect((await store.summaries(project.id))[0]).toMatchObject({
      title: updated.title,
      pinned: true,
      archived: true,
      revision: updated.revision,
    });
    expect(await store.sync(id, initial.revision)).toMatchObject({ kind: "delta" });
    await store.updateSession(id, { linkedWorkItem: null });
    expect((await store.summaries(project.id))[0].linkedWorkItem).toBeUndefined();

    await store.deleteSession(id);
    expect(await store.summaries(project.id)).toEqual([]);
    await expect(store.session(id)).rejects.toThrow("Session not found");
  });

  it("includes the harness ID in remote summaries, including older cached rows", async () => {
    const { store, project, id } = await setup();
    const current = await store.session(id);
    await store.save(
      {
        ...current,
        revision: current.revision + 1,
        session: { ...current.session, providerSessionId: "harness-session" },
      },
      { type: "session.test" },
    );
    expect((await store.summaries(project.id))[0].providerSessionId).toBe("harness-session");

    const legacySummary = { ...(await store.summaries(project.id))[0] };
    delete legacySummary.providerSessionId;
    await store.db
      .prepare("UPDATE session_state SET summary=? WHERE id=?")
      .run(JSON.stringify(legacySummary), id);
    expect((await store.summaries(project.id))[0].providerSessionId).toBe("harness-session");
    const repaired = (await store.db
      .prepare("SELECT summary FROM session_state WHERE id=?")
      .get(id))!;
    expect(JSON.parse(String(repaired.summary)).providerSessionId).toBe("harness-session");
  });

  it("keeps a legacy session's last known timestamp when adding creation time", async () => {
    const { directory, store, project, id } = await setup();
    const legacy = { ...(await store.session(id)) };
    delete legacy.createdAt;
    await store.db
      .prepare("UPDATE sessions SET snapshot=? WHERE id=?")
      .run(JSON.stringify(legacy), id);

    const reopened = new HostStore(join(directory, "host.db"));
    cleanups.push(async () => await reopened.close());
    const original = await reopened.session(id);
    await reopened.save(
      {
        ...original,
        revision: original.revision + 1,
        updatedAt: original.updatedAt + 1_000,
      },
      { type: "session.test" },
    );
    expect((await reopened.summaries(project.id))[0]).toMatchObject({
      createdAt: original.updatedAt,
      updatedAt: original.updatedAt + 1_000,
    });
  });

  it("preserves the transaction error and invalidates cached state if rollback fails", async () => {
    const { store, id } = await setup();
    const cached = await store.session(id);
    await store.db.prepare("UPDATE sessions SET snapshot=? WHERE id=?").run(
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
      await expect(
        store.transaction(() => {
          throw original;
        }),
      ).rejects.toThrow(original);
      expect((await store.session(id)).session.title).toBe("Updated");
    } finally {
      rollback.mockRestore();
      log.mockRestore();
      expect(store.transactionActive).toBe(false);
    }
  });
  it("keeps the checkout idle while a branch switch is in progress", async () => {
    const { engine, project, id, turns, waitForTurnStart } = await setup();
    let finishSwitch = () => {};
    const switching = engine.withIdleProject(
      project.id,
      () =>
        new Promise<void>((resolve) => {
          finishSwitch = resolve;
        }),
    );
    await expect(
      engine.command({
        type: "send",
        commandId: "during-switch",
        sessionId: id,
        text: "Work",
      }),
    ).rejects.toThrow("branch switch");
    await expect(
      engine.command({
        type: "create",
        commandId: "new-during-switch",
        projectId: project.id,
        harness: "codex",
        model: "codex:test",
        runtimeMode: "supervised",
      }),
    ).rejects.toThrow("branch switch");
    finishSwitch();
    await switching;
    await engine.command({
      type: "send",
      commandId: "after-switch",
      sessionId: id,
      text: "Work",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    turns[0].finish();
  });

  it("runs provider context compaction once and persists its transcript marker", async () => {
    const { engine, store, provider, id } = await setup();
    let finishCompact = () => {};
    let compactStarted!: () => void;
    const compactStart = new Promise<void>((resolve) => {
      compactStarted = resolve;
    });
    provider.compact = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCompact = resolve;
          compactStarted();
        }),
    );
    const command = { type: "compact", commandId: "compact", sessionId: id };
    const receipt = await engine.command(command);
    expect(await engine.command(command)).toEqual(receipt);
    await compactStart;
    expect(provider.compact).toHaveBeenCalledTimes(1);
    expect((await store.session(id)).session.blocks).toContainEqual(
      expect.objectContaining({ text: "/compact" }),
    );
    finishCompact();
    await engine.waitForRun(id, receipt.runId);
    expect((await store.session(id)).status).toBe("idle");
  });

  it("persists model and permission changes for the next turn and rejects changes mid-turn", async () => {
    const { engine, store, turns, id, waitForTurnStart } = await setup();
    const change = {
      type: "configure",
      commandId: "settings",
      sessionId: id,
      model: "codex:new",
      modelSettings: { reasoningEffort: "high" },
      runtimeMode: "full-access",
    };
    const receipt = await engine.command(change);
    expect(await engine.command(change)).toEqual(receipt);
    expect((await store.session(id)).session).toMatchObject({
      model: "codex:new",
      modelSettings: { reasoningEffort: "high" },
      runtimeMode: "full-access",
    });
    await engine.command({
      type: "send",
      commandId: "turn",
      sessionId: id,
      text: "Continue",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    expect(turns[0].input).toMatchObject({
      model: "codex:new",
      modelSettings: { reasoningEffort: "high" },
      runtimeMode: "full-access",
    });
    await expect(engine.command({ ...change, commandId: "later" })).rejects.toThrow("current turn");
    turns[0].finish();
  });
  it("keeps working with no client, persists output, and deduplicates a lost acknowledgement", async () => {
    const { engine, store, turns, provider, id, waitForTurnStart } = await setup();
    const command = {
      type: "send",
      commandId: "send-once",
      sessionId: id,
      text: "Do the work",
    };
    const receipt = await engine.command(command);
    expect(await engine.command(command)).toEqual(receipt);
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    expect(provider.send).toHaveBeenCalledTimes(1);
    const before = (await store.session(id)).revision;
    turns[0].input.onEvent({
      type: "session.providerBound",
      providerSessionId: "provider-thread",
    });
    turns[0].input.onEvent({
      type: "message.delta",
      text: "still working while disconnected",
    });
    turns[0].finish();
    await engine.waitForRun(id, receipt.runId);
    expect((await store.session(id)).status).toBe("idle");
    expect(
      (await store.session(id)).session.blocks.some((block) =>
        block.text.includes("still working"),
      ),
    ).toBe(true);
    expect((await store.events(id, before)).events?.length).toBeGreaterThan(1);
    expect(await engine.command(command)).toEqual(receipt);
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(provider.bind).toHaveBeenCalledWith(
      id,
      "provider-thread",
      expect.any(String),
      undefined,
    );
    await expect(engine.command({ ...command, text: "Changed payload" })).rejects.toThrow(
      "different payload",
    );
  });

  it.each(["codex", "claude"] as const)(
    "keeps %s turn timing and model provenance after settlement and reconnect",
    async (harness) => {
      const { engine, store, turns, id, waitForTurnStart } = await setup(harness);
      const receipt = await engine.command({
        type: "send",
        commandId: "first-turn",
        sessionId: id,
        text: "Inspect the project",
      });
      await waitForTurnStart();
      expect(turns).toHaveLength(1);
      const running = await store.session(id);
      expect(running.session.blocks[0]).toMatchObject({
        id: "first-turn",
        startedAt: expect.any(Number),
        turnModel: { harness, id: `${harness}:test` },
      });
      turns[0].input.onEvent({ type: "message.delta", text: "Found it" });
      turns[0].finish();
      await engine.waitForRun(id, receipt.runId);
      expect((await store.session(id)).status).toBe("idle");

      const reconnected = await store.sync(id);
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

      const delta = await store.sync(id, running.revision);
      expect(delta.kind).toBe("delta");
      if (delta.kind === "delta")
        expect(
          delta.blocks.some((block) => block.id === "first-turn" && block.durationMs != null),
        ).toBe(true);
    },
  );

  it("serializes concurrent sends and accepts only one approval decision for a run", async () => {
    const { engine, store, turns, provider, id, waitForTurnStart } = await setup();
    await engine.command({
      type: "send",
      commandId: "send",
      sessionId: id,
      text: "Work",
    });
    await expect(
      engine.command({
        type: "send",
        commandId: "other-send",
        sessionId: id,
        text: "More work",
      }),
    ).rejects.toThrow("already running");
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    turns[0].input.onEvent({
      type: "approval.requested",
      requestId: 7,
      occurrenceId: "7e1c4dc0-6f53-4a8c-b8d8-000000000001",
      title: "Run a command?",
    });
    const runId = (await store.session(id)).runId!;
    const approval = {
      type: "approve",
      commandId: "approval-1",
      sessionId: id,
      runId,
      requestId: 7,
      approvalOccurrenceId: "7e1c4dc0-6f53-4a8c-b8d8-000000000001",
      decision: "allow",
    };
    await expect(engine.command({ ...approval, runId: "stale" })).rejects.toThrow(
      "finished or replaced",
    );
    await engine.command(approval);
    await engine.command(approval);
    await expect(
      engine.command({
        ...approval,
        commandId: "approval-2",
        decision: "deny",
      }),
    ).rejects.toThrow("already resolved");
    expect(provider.approve).toHaveBeenCalledTimes(1);
    expect(provider.approve).toHaveBeenCalledWith(
      id,
      7,
      "allow",
      "7e1c4dc0-6f53-4a8c-b8d8-000000000001",
    );
  });

  it("rejects a stale occurrence when the same running provider reuses its numeric approval ID", async () => {
    const { engine, store, turns, provider, id, waitForTurnStart } = await setup();
    const occurrenceA = "7e1c4dc0-6f53-4a8c-b8d8-000000000001";
    const occurrenceB = "7e1c4dc0-6f53-4a8c-b8d8-000000000002";
    await engine.command({
      type: "send",
      commandId: "occurrence-send",
      sessionId: id,
      text: "Work",
    });
    await waitForTurnStart();
    const runId = (await store.session(id)).runId!;
    turns[0].input.onEvent({
      type: "approval.requested",
      requestId: 7,
      occurrenceId: occurrenceA,
      callId: "A",
      title: "Same operation",
    });
    const first = {
      type: "approve",
      commandId: "approve-A",
      sessionId: id,
      runId,
      requestId: 7,
      approvalOccurrenceId: occurrenceA,
      decision: "allow",
    };
    await expect(engine.command({ ...first, approvalOccurrenceId: undefined })).rejects.toThrow(
      "identity is missing or invalid",
    );
    await expect(engine.command({ ...first, approvalOccurrenceId: occurrenceB })).rejects.toThrow(
      "request changed",
    );
    const receipt = await engine.command(first);
    // Durable acceptance precedes the committed effect's authority await. Start
    // the second occurrence only after A reached its actual provider callback;
    // the separate latch case exercises replacement during that await.
    await vi.waitFor(() =>
      expect(provider.approve).toHaveBeenCalledExactlyOnceWith(id, 7, "allow", occurrenceA),
    );
    turns[0].input.onEvent({
      type: "approval.requested",
      requestId: 7,
      occurrenceId: occurrenceB,
      callId: "B",
      title: "Same operation",
    });
    await expect(engine.command({ ...first, commandId: "late-A" })).rejects.toThrow(
      "request changed",
    );
    await expect(engine.command(first)).resolves.toEqual(receipt);
    await expect(engine.command({ ...first, decision: "deny" })).rejects.toThrow();
    await engine.command({
      ...first,
      commandId: "approve-B",
      approvalOccurrenceId: occurrenceB,
      decision: "deny",
    });
    await vi.waitFor(() =>
      expect(vi.mocked(provider.approve).mock.calls).toEqual([
        [id, 7, "allow", occurrenceA],
        [id, 7, "deny", occurrenceB],
      ]),
    );
    const approvals = (await store.session(id)).session.blocks.filter(
      (block) => block.approval?.requestId === 7,
    );
    expect(approvals.map((block) => block.approval)).toEqual([
      { requestId: 7, occurrenceId: occurrenceA, decided: "allow" },
      { requestId: 7, occurrenceId: occurrenceB, decided: "deny" },
    ]);
  });

  it("rechecks the actual approval source after the committed effect's authority await", async () => {
    const { engine, store, turns, provider, id, waitForTurnStart } = await setup();
    const occurrenceA = "7e1c4dc0-6f53-4a8c-b8d8-000000000001";
    const occurrenceB = "7e1c4dc0-6f53-4a8c-b8d8-000000000002";
    await engine.command({ type: "send", commandId: "guard-send", sessionId: id, text: "Work" });
    await waitForTurnStart();
    const runId = (await store.session(id)).runId!;
    turns[0].input.onEvent({
      type: "approval.requested",
      requestId: 7,
      occurrenceId: occurrenceA,
      callId: "A",
      title: "Original request",
    });
    const callbacks: Array<() => void | Promise<void>> = [];
    const defer = vi.spyOn(store, "afterCommit").mockImplementation((effect) => {
      callbacks.push(effect);
    });
    const receipt = await engine.command({
      type: "approve",
      commandId: "guard-A",
      sessionId: id,
      runId,
      requestId: 7,
      approvalOccurrenceId: occurrenceA,
      decision: "allow",
    });
    defer.mockRestore();
    const effect = callbacks.pop();
    expect(effect).toBeDefined();
    for (const callback of callbacks) await callback();
    expect(provider.approve).not.toHaveBeenCalled();
    let entered!: () => void, release!: () => void;
    const authorityEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalAssert = store.assertAuthority.bind(store);
    let waiting = true;
    const authority = vi.spyOn(store, "assertAuthority").mockImplementation(async (...args) => {
      await originalAssert(...args);
      if (waiting) {
        waiting = false;
        entered();
        await gate;
      }
    });
    const dispatch = Promise.resolve(effect!());
    // Observe immediately even if an unexpectedly early failure occurs during the latch.
    void dispatch.catch(() => {});
    try {
      await authorityEntered;
      authority.mockRestore();
      turns[0].input.onEvent({
        type: "approval.requested",
        requestId: 7,
        occurrenceId: occurrenceB,
        callId: "B",
        title: "Replacement request",
      });
      await vi.waitFor(async () => {
        expect(
          (await store.session(id)).session.blocks.some(
            (block) => block.approval?.occurrenceId === occurrenceB,
          ),
        ).toBe(true);
      });
    } finally {
      authority.mockRestore();
      release();
    }
    await expect(dispatch).rejects.toThrow("original approval source changed");
    expect(provider.approve).not.toHaveBeenCalled();
    expect(await store.receiptStatus("guard-A")).toEqual(receipt);
  });

  it.each(["unknown", "typed"])(
    "rejects %s question file targets before provider dispatch",
    async (target) => {
      const { engine, turns, provider, id, waitForTurnStart } = await setup();
      const receipt = await engine.command({
        type: "send",
        commandId: "question-invalid-file-start",
        sessionId: id,
        text: "Work",
      });
      await waitForTurnStart();
      turns[0].input.onEvent({
        type: "question.asked",
        requestId: 9,
        questions: [
          {
            id: "q1",
            prompt: "Exact input",
            allowCustom: true,
            preserveCustomWhitespace: target === "typed",
            multiSelect: false,
            options: [],
          },
        ],
      });
      await expect(
        engine.command({
          type: "answer",
          commandId: "question-invalid-file-answer",
          sessionId: id,
          runId: receipt.runId,
          requestId: 9,
          reply: {
            kind: "answered",
            answers: {},
            attachments: {
              [target === "unknown" ? "missing" : "q1"]: [
                {
                  id: "fd546e23-7950-4213-97c5-385b9ce041fe",
                  name: "report.txt",
                  mimeType: "text/plain",
                  kind: "file",
                  size: 3,
                },
              ],
            },
          },
        }),
      ).rejects.toThrow("This question cannot accept attachments");
      expect(provider.answer).not.toHaveBeenCalled();
    },
  );

  it("resolves question files on the executing Host and retains them in the answer transcript", async () => {
    const { engine, store, turns, provider, id, waitForTurnStart } = await setup();
    const receipt = await engine.command({
      type: "send",
      commandId: "question-file-start",
      sessionId: id,
      text: "Work",
    });
    await waitForTurnStart();
    const file = {
      id: "fd546e23-7950-4213-97c5-385b9ce041fe",
      name: "report.txt",
      mimeType: "text/plain",
      kind: "file" as const,
      size: 3,
    };
    await writeAttachmentChunk(store, { id: file.id, size: 3, offset: 0, data: "YWJj" });
    turns[0].input.onEvent({
      type: "question.asked",
      requestId: 9,
      questions: [
        { id: "q1", prompt: "Attach report", allowCustom: true, multiSelect: false, options: [] },
      ],
    });
    await engine.command({
      type: "answer",
      commandId: "question-file-answer",
      sessionId: id,
      runId: receipt.runId,
      requestId: 9,
      reply: {
        kind: "answered",
        answers: {},
        attachments: { q1: [{ ...file, path: "C:\\wrong-machine\\report.txt" }] },
      },
    });
    await vi.waitFor(() => expect(provider.answer).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(provider.answer).mock.calls.at(-1)![2];
    expect(sent.kind).toBe("answered");
    if (sent.kind !== "answered") throw new Error("Expected file answer");
    const path = sent.attachments?.q1[0].path;
    expect(path).toBeTruthy();
    expect(path).not.toContain("wrong-machine");
    expect(readFileSync(path!, "utf8")).toBe("abc");
    turns[0].input.onEvent({
      type: "question.resolved",
      requestId: 9,
      decision: "answered",
      reply: sent,
    });
    await vi.waitFor(async () => {
      const block = (await store.session(id)).session.blocks.at(-1);
      expect(block?.attachments).toEqual([{ ...file, path }]);
      expect(block?.text).toContain("Attached file (read from disk):");
    });
  });

  it("stores pending questions and rejects a second device's stale answer", async () => {
    const { engine, store, turns, provider, id, waitForTurnStart } = await setup();
    await engine.command({
      type: "send",
      commandId: "send",
      sessionId: id,
      text: "Work",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
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
      runId: (await store.session(id)).runId,
      requestId: 3,
      reply: { kind: "answered", answers: { q1: ["yes"] } },
    };
    await engine.command(reply);
    expect((await store.session(id)).session.pendingQuestion).toMatchObject({
      requestId: 3,
      delivery: "sending",
    });
    expect((await store.session(id)).session.blocks.at(-1)?.text).toBe("Work");
    await expect(engine.command({ ...reply, commandId: "concurrent-answer" })).rejects.toThrow(
      "already pending delivery",
    );
    const blockCount = (await store.session(id)).session.blocks.length;
    turns[0].input.onEvent({
      type: "question.resolved",
      requestId: 3,
      decision: "answered",
      reply: { kind: "answered", answers: { q1: ["yes"] } },
    });
    await vi.waitFor(async () => {
      const accepted = (await store.session(id)).session;
      expect(accepted.pendingQuestion).toBeUndefined();
      expect(accepted.blocks).toHaveLength(blockCount + 1);
      expect(accepted.blocks.at(-1)).toMatchObject({ role: "user", text: "Choose\nYes" });
    });
    await expect(engine.command({ ...reply, commandId: "other-answer" })).rejects.toThrow(
      "already resolved",
    );
    expect(provider.answer).toHaveBeenCalledTimes(1);
  });

  it("recovers interrupted durable state without replaying an uncertain provider send", async () => {
    const { store, provider, id } = await setup();
    const value = await store.session(id);
    await store.transaction(
      async () =>
        await store.save(
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
    await recovered.ready;
    // Whoever drains the queue is told which turns were cut short by the restart.
    expect(recovered.recoveredInterrupted).toEqual([id]);
    expect((await store.session(id)).status).toBe("interrupted");
    expect((await store.session(id)).session.busy).toBe(false);
    expect((await store.session(id)).session.blocks[0].durationMs).toBe(2_000);
    expect(provider.send).not.toHaveBeenCalled();
    expect(provider.bind).toHaveBeenCalledWith(id, "retained", value.session.cwd, undefined);
    await recovered.close();
  });

  it("resumes a conversation under its provider account", async () => {
    const { engine, store, provider, turns, id, waitForTurnStart } = await setup("claude");
    const value = await store.session(id);
    await store.save(
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
    await engine.command({ type: "send", commandId: "send", sessionId: id, text: "Continue" });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
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
    const { engine, store, turns, id, waitForTurnStart } = await setup();
    await engine.command({
      type: "send",
      commandId: "send",
      sessionId: id,
      text: "Work",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
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
      await vi.waitFor(async () => expect((await store.session(id)).status).toBe("interrupted"), {
        timeout: 4_000,
      });
      expect(
        (await store.session(id)).session.blocks.some((block) => block.text === "Retained output"),
      ).toBe(true);
      expect((await store.session(id)).session.busy).toBe(false);
    } finally {
      log.mockRestore();
    }
  });

  it("retries a failed final settlement", async () => {
    const { engine, store, turns, id, waitForTurnStart } = await setup();
    const ended: Array<{
      cancelled?: boolean;
      error?: string;
      interrupted?: boolean;
      reason?: string;
    }> = [];
    engine.onSettled = (_id, outcome) => void ended.push(outcome);
    await engine.command({
      type: "send",
      commandId: "send",
      sessionId: id,
      text: "Work",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
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
      await vi.waitFor(async () => expect((await store.session(id)).status).toBe("interrupted"), {
        timeout: 4_000,
      });
      expect((await store.session(id)).session.busy).toBe(false);
      // The retry path tells the queue's drainer the turn was cut short, like the normal one.
      expect(ended).toEqual([
        expect.objectContaining({
          interrupted: true,
          reason: expect.stringContaining("storage failed"),
        }),
      ]);
    } finally {
      log.mockRestore();
    }
  });

  it("batches streamed output and syncs only changed blocks", async () => {
    const { engine, store, turns, id, project, waitForTurnStart } = await setup();
    const runReceipt = await engine.command({
      type: "send",
      commandId: "send",
      sessionId: id,
      text: "Work",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    const started = (await store.session(id)).revision;
    for (let index = 0; index < 50; index++)
      turns[0].input.onEvent({
        type: "message.delta",
        text: `chunk ${index} `,
      });
    expect((await store.session(id)).revision).toBe(started);
    await vi.waitFor(async () => expect((await store.session(id)).revision).toBe(started + 1));
    const sync = await store.sync(id, started);
    expect(sync.kind).toBe("delta");
    if (sync.kind !== "delta") return;
    expect(sync.blocks.map((block) => block.role)).toEqual(["assistant"]);
    expect(sync.blockIds).toHaveLength(2);

    turns[0].input.onEvent({
      type: "approval.requested",
      requestId: 1,
      title: "Run a command?",
    });
    expect((await store.session(id)).revision).toBe(started + 2);

    const streamed = (await store.session(id)).revision;
    turns[0].finish();
    await engine.waitForRun(id, runReceipt.runId);
    expect((await store.session(id)).status).toBe("idle");
    const settled = await store.sync(id, streamed);
    if (settled.kind !== "delta") throw new Error("Expected a delta");
    expect(settled.blocks.some((block) => block.role === "user" && block.durationMs != null)).toBe(
      true,
    );
    expect((await store.sync(id, (await store.session(id)).revision)).kind).toBe("unchanged");
    expect((await store.sync(id)).kind).toBe("snapshot");
    expect((await store.summaries(project.id))[0]).toMatchObject({
      id,
      status: "idle",
      title: "codex · Work",
    });
  });

  it("catches a client up from a stale copy even after the host trimmed its event log", async () => {
    const { engine, store, turns, id, waitForTurnStart } = await setup();
    const runReceipt = await engine.command({
      type: "send",
      commandId: "work",
      sessionId: id,
      text: "Work",
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    const stale = await store.session(id);
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
    await engine.waitForRun(id, runReceipt.runId);
    expect((await store.session(id)).status).toBe("idle");
    const current = await store.session(id);
    expect(current.revision).toBeGreaterThan(stale.revision + 1);

    // The retained events no longer reach back to the client's revision.
    await store.db
      .prepare("DELETE FROM events WHERE session_id=? AND revision<=?")
      .run(id, stale.revision + 1);
    expect((await store.events(id, stale.revision)).snapshot?.revision).toBe(current.revision);

    // The app does not read events: its sync is by block revision, so the
    // stale copy still becomes the host's state, in order and without repeats.
    const sync = await store.sync(id, stale.revision);
    expect(sync.kind).toBe("delta");
    const caughtUp = applySessionSync(stale, sync);
    expect(caughtUp.session.blocks.map((block) => block.id)).toEqual(
      current.session.blocks.map((block) => block.id),
    );
    expect(caughtUp.session.blocks).toEqual(current.session.blocks);
    expect(caughtUp.status).toBe("idle");

    // A client ahead of the host (restored or replaced host) reloads in full.
    expect((await store.sync(id, current.revision + 10)).kind).toBe("snapshot");
  });

  it("requires snapshot recovery when the client's event cursor is invalid", async () => {
    const { store, id } = await setup();
    expect((await store.events(id, 100_000)).snapshot?.session.id).toBe(id);
  });

  it("arms a remote usage limit only from the desktop's setting", async () => {
    const { engine, store, turns, id, waitForTurnStart } = await setup();
    const limit = async (commandId: string, resumeAtReset?: boolean) => {
      const receipt = await engine.command({
        type: "send",
        commandId,
        sessionId: id,
        text: "Work",
        ...(resumeAtReset === undefined ? {} : { resumeAtReset }),
      });
      await waitForTurnStart();
      expect(turns.at(-1)?.input.text).toBe("Work");
      const turn = turns.pop()!;
      turn.input.onEvent({ type: "usage.limited", resetsAt: 5_000 });
      turn.finish();
      await engine.waitForRun(id, receipt.runId);
      expect((await store.session(id)).status).toBe("idle");
      return (await store.session(id)).session.usageLimit;
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
    const { engine, store, turns, id, waitForTurnStart } = await setup();
    const runReceipt = await engine.command({
      type: "send",
      commandId: "limited",
      sessionId: id,
      text: "Work",
      resumeAtReset: true,
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    turns[0].input.onEvent({ type: "usage.limited", resetsAt: 5_000 });
    turns[0].finish();
    await engine.waitForRun(id, runReceipt.runId);
    expect((await store.session(id)).status).toBe("idle");

    await engine.command({
      type: "usageLimit",
      commandId: "cancel",
      sessionId: id,
      action: "disarm",
    });
    expect((await store.session(id)).session.usageLimit).toEqual({
      resetsAt: 5_000,
      resumeAtReset: false,
    });
    await engine.command({
      type: "usageLimit",
      commandId: "arm",
      sessionId: id,
      action: "arm",
    });
    expect((await store.session(id)).session.usageLimit).toEqual({
      resetsAt: 5_000,
      resumeAtReset: true,
    });
    await engine.command({
      type: "usageLimit",
      commandId: "dismiss",
      sessionId: id,
      action: "dismiss",
    });
    expect((await store.session(id)).session.usageLimit).toBeUndefined();
  });

  it("clears the usage limit once the host accepts the next turn", async () => {
    const { engine, store, turns, id, waitForTurnStart } = await setup();
    const firstRunReceipt = await engine.command({
      type: "send",
      commandId: "limited",
      sessionId: id,
      text: "Work",
      resumeAtReset: true,
    });
    await waitForTurnStart();
    expect(turns).toHaveLength(1);
    turns[0].input.onEvent({ type: "usage.limited", resetsAt: 5_000 });
    turns[0].finish();
    await engine.waitForRun(id, firstRunReceipt.runId);
    expect((await store.session(id)).status).toBe("idle");
    expect((await store.session(id)).session.usageLimit?.resumeAtReset).toBe(true);

    const secondRunReceipt = await engine.command({
      type: "send",
      commandId: "continue",
      sessionId: id,
      text: "Continue",
      resumeAtReset: true,
    });
    // Left in place, the armed limit would resume this session again after
    // the continue turn ends.
    expect((await store.session(id)).session.usageLimit).toBeUndefined();
    await waitForTurnStart(2);
    expect(turns).toHaveLength(2);
    turns[1].finish();
    await engine.waitForRun(id, secondRunReceipt.runId);
    expect((await store.session(id)).status).toBe("idle");
    expect((await store.session(id)).session.usageLimit).toBeUndefined();
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
