import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { HostStore } from "../store";
import { HostEngine } from "../engine";
import { createHostServer } from "../server";
import { socialToolCatalog } from "../social/social-tools";
import { defaultCrewPolicy } from "../../src/features/crews/model/crew";
import {
  parseVoiceToolCall,
  prepareVoiceToolDispatch,
  validateVoiceToolList,
  voiceToolCatalog,
  type VoiceToolDispatchPorts,
} from "./voice-tools";

const request = () => ({
  projectId: "project-a",
  sessionId: "session-a",
  family: "conversation",
  action: "notes.create",
  input: { id: "note-a", body: "Unsent voice note" },
});

it("routes real owner voice RPCs through scoped tools without leaking or retaining grants", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-voice-tools-"));
  const desktopPath = join(directory, "desktop.db");
  const desktop = new DatabaseSync(desktopPath);
  desktop.exec(
    `CREATE TABLE notes(id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',tags_json TEXT NOT NULL DEFAULT '[]',source_session_id TEXT,source_cwd TEXT,slug_pending INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`,
  );
  desktop.close();
  vi.stubEnv("BYCODA_DESKTOP_DB", desktopPath);
  const store = new HostStore(join(directory, "host.db"));
  const engine = new HostEngine(store, {
    codex: {
      send: async () => {},
      stop: async () => {},
      cancel: async () => {},
      bind: () => {},
      approve: () => {},
      answer: () => {},
    },
  });
  const project = await engine.openProject(directory);
  const server = await createHostServer(engine, ["codex"]);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const owner = await store.issueDevice("Voice fixture owner");
    const created = await engine.command({
      type: "create",
      workspaceMode: "current",
      commandId: "voice-controller-fixture",
      projectId: project.id,
      harness: "codex",
      model: "gpt",
      runtimeMode: "supervised",
    });
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
    const call = async (method: string, params: Record<string, unknown>, token = owner.token) => {
      const reply = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
      });
      return (await reply.json()) as { result?: any; error?: string };
    };
    const target = { projectId: project.id, sessionId: created.sessionId };
    const catalog = await call("voice.tools.list", { projectId: project.id });
    expect(catalog.error).toBeUndefined();
    expect(catalog.result.tools.some((tool: { family: string }) => tool.family === "social")).toBe(
      true,
    );
    const mint = vi.spyOn(server.conversationAccess, "issueSessionGrant");
    const note = await call("voice.tools.call", {
      ...target,
      family: "conversation",
      action: "notes.create",
      input: {
        id: "voice-note-fixture",
        title: "Voice note",
        body: "Saved through the real tools dispatcher.",
      },
    });
    expect(note.error).toBeUndefined();
    expect(note.result).toMatchObject({
      id: "voice-note-fixture",
      body: "Saved through the real tools dispatcher.",
    });
    const minted = await mint.mock.results[0].value;
    expect(JSON.stringify(note)).not.toContain(minted.token);
    expect(await server.conversationAccess.principalForToken(minted.token)).toBeUndefined();
    const read = await call("voice.tools.call", {
      ...target,
      family: "conversation",
      action: "notes.read",
      input: { id: "voice-note-fixture" },
    });
    expect(read.result.body).toBe("Saved through the real tools dispatcher.");
    const social = await call("voice.tools.call", {
      ...target,
      family: "social",
      action: "accounts.list",
      input: {},
      requestId: "voice-accounts-fixture",
    });
    expect(social.error).toBeUndefined();
    const logs = await call("voice.tools.call", {
      ...target,
      family: "runtime-logs",
      action: "sources",
      input: {},
    });
    expect(logs.error).toBeUndefined();
    const claim = () =>
      call("voice.tools.call", {
        ...target,
        family: "conversation",
        action: "browser.claim",
        input: {},
      });
    const firstClaim = await claim();
    const secondClaim = await claim();
    expect(firstClaim.error).toBeUndefined();
    expect(firstClaim.result.leaseId).toBeTruthy();
    expect(secondClaim.error).toBeUndefined();
    expect(secondClaim.result.leaseId).toBe(firstClaim.result.leaseId);
    const released = await call("voice.tools.call", {
      ...target,
      family: "conversation",
      action: "browser.release",
      input: { leaseId: firstClaim.result.leaseId },
    });
    expect(released.error).toBeUndefined();
    const sibling = await server.conversationAccess.issueSessionGrant(created.sessionId!);
    const attemptedEscalation = await call(
      "voice.tools.list",
      { projectId: project.id },
      sibling.token,
    );
    expect(attemptedEscalation.error).toMatch(/owner device/);
    const mismatched = await call("voice.tools.call", {
      ...target,
      projectId: "other-project",
      family: "conversation",
      action: "notes.list",
      input: {},
    });
    expect(mismatched.error).toMatch(/another project/);
    const missingContext = await call("voice.tools.call", {
      projectId: project.id,
      family: "conversation",
      action: "notes.list",
      input: {},
    });
    expect(missingContext.error).toMatch(/explicit verified project and session/);
    // Real owner HTTP route, true assistant-thread grant and no coding session.
    // Status reads isolated configuration; it never launches a desktop process.
    const opened = await call("assistant.request", { op: "threads.open" }),
      thread = opened.result.thread;
    const globalCatalog = await call("voice.tools.list", { threadId: thread.id });
    expect(globalCatalog.result.tools.length).toBeGreaterThan(0);
    expect((await call("voice.tools.list", { threadId: "missing-thread" })).error).toMatch(/verified global assistant thread/);
    const globalTools = await call("voice.tools.call", {
      threadId: thread.id, family: "conversation", action: "tools.list", input: {},
    });
    expect(globalTools.result.tools.length).toBeGreaterThan(0);
    const crewRead = await call("voice.tools.call", {
      threadId: thread.id, projectId: project.id,
      family: "conversation", action: "crews.list", input: { limit: 10 },
    });
    // A real Room project scope requires its live native issuer; this fixture is offline.
    expect(crewRead.error).toContain("Desktop relay is offline");
    let reviews: any[] = [];
    await call("conversation.desktop.take", {});
    const directoryRead = call("voice.tools.call", { threadId: thread.id, family: "conversation", action: "projects.organization.read", input: { offset: 2, limit: 3 } });
    reviews = [];
    for (let attempt = 0; attempt < 100 && !reviews.length; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      reviews = (await call("conversation.desktop.take", {})).result;
    }
    expect(reviews[0]).toMatchObject({ action: "organization.read", threadId: thread.id, input: { offset: 2, limit: 3 } });
    expect(reviews[0]).not.toHaveProperty("projectId");
    await call("conversation.desktop.finish", { id: reviews[0].id, result: { items: [{ cwd: project.cwd, name: "Visible" }, { cwd: "unregistered", name: "Unregistered" }], total: 5, nextOffset: null } });
    expect((await directoryRead).result).toMatchObject({ items: [{ cwd: project.cwd, projectId: project.id }, { cwd: "unregistered" }], total: 5 });
    const serverInput = { id: "saved-server", operationId: "remove-server-once", expectedInventoryRevision: "a".repeat(64) };
    const remove = call("voice.tools.call", { threadId: thread.id, family: "conversation", action: "servers.ssh.remove", input: serverInput });
    reviews = [];
    for (let attempt = 0; attempt < 100 && !reviews.length; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      reviews = (await call("conversation.desktop.take", {})).result;
    }
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ action: "management.write.authorize", threadId: thread.id, input: { operation: { action: "servers.ssh.remove", input: { serverInput } } } });
    await call("conversation.desktop.finish", { id: reviews[0].id, result: { approved: true, operationHash: reviews[0].input.operation.operationHash } });
    reviews = [];
    for (let attempt = 0; attempt < 100 && !reviews.length; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      reviews = (await call("conversation.desktop.take", {})).result;
    }
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ action: "servers.ssh.remove", threadId: thread.id, input: { id: "saved-server", expectedInventoryRevision: "a".repeat(64) } });
    expect(reviews[0].input).not.toHaveProperty("operationId");
    await call("conversation.desktop.finish", { id: reviews[0].id, result: { removed: true } });
    expect((await remove).result).toMatchObject({ state: "completed", result: { removed: true } });
    expect((await call("voice.tools.call", { threadId: thread.id, family: "conversation", action: "servers.ssh.remove", input: serverInput })).result).toMatchObject({ state: "completed" });
    expect((await call("conversation.desktop.take", {})).result).toEqual([]);
    expect((await call("voice.tools.call", {
      threadId: thread.id, family: "conversation", action: "tasks.list", input: {},
    })).error).toMatch(/supported global operation/);
    const ownerTurn = await call("assistant.request", {
      op: "threads.append",
      threadId: thread.id,
      role: "user",
      via: "voice",
      text: "Check computer control status",
      idempotencyKey: "desktop-status-owner",
    });
    const causal = await call("assistant.request", {
      op: "voice.context.open",
      threadId: thread.id,
      ownerMessageId: ownerTurn.result.message.id,
      requestId: "desktop-status-context",
      generationKey: "actual-owner-http",
      seedMessageIds: [],
      contextProjectIds: [project.id],
      summaryUsed: false,
    });
    const computer = await call("voice.tools.call", {
      projectId: project.id,
      threadId: thread.id,
      causalContextId: causal.result.voiceContext.id,
      family: "conversation",
      action: "desktop.status",
      input: {},
      requestId: "desktop-status-once",
    });
    expect(computer.error).toBeUndefined();
    expect(computer.result.value).toBeDefined();
    expect(computer.result.voiceContext.status).toBe("unknown");
    expect(computer.result.voiceDisclosure).toMatchObject({
      verified: false,
      requestId: "desktop-status-once",
      source: {
        environmentId: store.environmentId,
        projectId: project.id,
        threadId: thread.id,
        family: "conversation",
        action: "desktop.status",
      },
    });
    expect(computer.result.voiceDisclosure.source).not.toHaveProperty("sessionId");
    expect(computer.result.voiceDisclosure).not.toHaveProperty("projectIds");
    const replay = await call("voice.tools.call", {
      projectId: project.id,
      threadId: thread.id,
      causalContextId: causal.result.voiceContext.id,
      family: "conversation",
      action: "desktop.status",
      input: {},
      requestId: "desktop-status-once",
    });
    expect(replay.error).toMatch(/instead of replaying/);
    await store.revokeToken(owner.token);
    expect((await call("voice.tools.list", { projectId: project.id })).error).toMatch(
      /invalid or revoked/,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.closeResources();
    await engine.close();
    await store.close();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
});

function ports() {
  const issuer = () => ({
    issueSessionGrant: vi.fn(async (sessionId: string) => ({
      token: "private-request-bound-grant",
      scope: {
        projectId: "project-a",
        sessionId,
        provider: "codex",
        environmentId: "host-a",
      },
    })),
    revokeSessionGrant: vi.fn(),
  });
  return {
    authorized: vi.fn(async () => true),
    environmentId: "host-a",
    deviceHash: "verified-owner-device-hash",
    sessionIdentity: vi.fn(async () => ({ projectId: "project-a", provider: "codex" })),
    issuers: { conversation: issuer(), social: issuer(), "runtime-logs": issuer() },
  } satisfies VoiceToolDispatchPorts;
}

it("binds causal disclosure metadata to the verified grant and rejects malformed context envelopes", async () => {
  for (const extra of [
    { causalContextId: "ctx" },
    { causalContextId: "ctx", requestId: "request" },
    { causalContextId: 1, threadId: "thread", requestId: "request" },
  ])
    expect(() => parseVoiceToolCall({ ...request(), ...extra })).toThrow();
  const p = {
    ...ports(),
    threadIdentity: vi.fn(async () => ({ id: "thread", projectId: "project-a" })),
  };
  const dispatch = await prepareVoiceToolDispatch(
    {
      ...request(),
      threadId: "thread",
      requestId: "exact-request",
      causalContextId: "captured-context",
    },
    p,
  );
  expect(dispatch.causalContextId).toBe("captured-context");
  expect(dispatch.source).toEqual({
    threadId: "thread",
    projectId: "project-a",
    sessionId: "session-a",
    family: "conversation",
    action: "notes.create",
  });
  expect(dispatch.params).not.toHaveProperty("causalContextId");
  dispatch.release();
  const changed = ports();
  changed.issuers.conversation.issueSessionGrant.mockResolvedValue({
    token: "foreign",
    scope: {
      projectId: "other-project",
      sessionId: "session-a",
      provider: "codex",
      environmentId: "host-a",
    },
  });
  await expect(prepareVoiceToolDispatch(request(), changed)).rejects.toThrow("grant scope changed");
  expect(changed.issuers.conversation.revokeSessionGrant).toHaveBeenCalledWith("foreign");
});

describe("voice tool gateway", () => {
  it("discovers all three families while retaining authoritative schemas", () => {
    const tools = voiceToolCatalog();
    expect(new Set(tools.map((tool) => tool.family))).toEqual(
      new Set(["conversation", "social", "runtime-logs"]),
    );
    expect(tools.find((tool) => tool.action === "notes.update")?.inputSchema).toMatchObject({
      required: ["id", "expectedUpdatedAt"],
    });
    expect(
      tools.find((tool) => tool.family === "social" && tool.action === "policy.get"),
    ).toBeDefined();
    expect(
      tools.find((tool) => tool.family === "runtime-logs" && tool.action === "read"),
    ).toMatchObject({ annotations: { readOnlyHint: true } });
    expect(tools.filter((tool) => tool.family === "social")).toEqual(
      socialToolCatalog().map((tool) => ({ ...tool, family: "social" })),
    );
    expect(
      tools.find((tool) => tool.family === "social" && tool.action === "replies.send"),
    ).toMatchObject({
      inputSchema: { properties: { requestId: { maxLength: 200 } } },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    });
  });

  it("preserves stable social receipt IDs without placing transport fields in the authorized payload", async () => {
    const p = ports();
    const input = {
      ...request(),
      family: "social",
      action: "replies.send",
      input: { id: "draft-a", requestId: "voice-retry:1" },
    };
    const first = await prepareVoiceToolDispatch(input, p);
    const next = await prepareVoiceToolDispatch({ ...input, requestId: "voice-retry:1" }, p);
    expect(first.params).toEqual({
      action: "replies.send",
      input: { id: "draft-a" },
      requestId: "voice-retry:1",
    });
    expect(next.params).toEqual(first.params);
    expect(first.method).toBe("social.tools.call");
    expect(p.issuers.social.issueSessionGrant).toHaveBeenCalledTimes(2);
    expect(p.issuers.conversation.issueSessionGrant).not.toHaveBeenCalled();
    expect(input.input.requestId).toBe("voice-retry:1");
    first.release();
    next.release();
  });

  it("rejects social authority injection and conflicting receipts before issuing grants", async () => {
    const p = ports();
    const social = {
      ...request(),
      family: "social",
      action: "replies.send",
      input: { id: "draft-a" },
    };
    for (const field of ["provider", "actorId", "sessionId", "socialAccountId", "operationId"])
      await expect(
        prepareVoiceToolDispatch(
          {
            ...social,
            input: { ...social.input, [field]: "forged" },
          },
          p,
        ),
      ).rejects.toThrow(/assigned by the host/);
    await expect(
      prepareVoiceToolDispatch(
        {
          ...social,
          input: { ...social.input, requestId: "embedded" },
          requestId: "different",
        },
        p,
      ),
    ).rejects.toThrow(/Conflicting/);
    await expect(
      prepareVoiceToolDispatch(
        {
          ...social,
          input: { ...social.input, requestId: "invalid receipt" },
        },
        p,
      ),
    ).rejects.toThrow(/Invalid social requestId/);
    expect(p.issuers.social.issueSessionGrant).not.toHaveBeenCalled();
  });

  it("routes discovery through the existing conversation grant", async () => {
    const p = ports();
    for (const [action, input] of [
      ["tools.search", { query: "browser" }],
      ["tools.describe", { ids: ["conversation:browser.open"] }],
      ["tools.status", {}],
    ] as const) {
      const dispatch = await prepareVoiceToolDispatch({ ...request(), action, input }, p);
      expect(dispatch.method).toBe("conversation.tools.call");
      expect(dispatch.params).toEqual({ action, input });
      dispatch.release();
    }
    expect(p.issuers.conversation.issueSessionGrant).toHaveBeenCalledTimes(3);
    expect(p.issuers.social.issueSessionGrant).not.toHaveBeenCalled();
  });

  it("accepts global thread discovery and refuses missing or injected identity", () => {
    expect(() => validateVoiceToolList({ projectId: "project-a" })).not.toThrow();
    expect(() => validateVoiceToolList({ threadId: "thread-a" })).not.toThrow();
    expect(() => validateVoiceToolList({})).toThrow(/verified project/);
    expect(() => validateVoiceToolList({ projectId: "project-a", principal: "owner" })).toThrow();
  });

  it("refuses missing session, unknown family/action and protected envelope fields", () => {
    for (const input of [
      { ...request(), sessionId: undefined },
      { ...request(), family: "owner" },
      { ...request(), action: "host.settings.set" },
      { ...request(), provider: "owner" },
      { ...request(), token: "attacker-token" },
      { ...request(), requestId: " " },
    ])
      expect(() => parseVoiceToolCall(input)).toThrow();
  });

  it("validates Conversation Tool schemas before issuing any authority", async () => {
    const p = ports();
    await expect(
      prepareVoiceToolDispatch({ ...request(), input: { id: "note-a" } }, p),
    ).rejects.toThrow();
    expect(p.issuers.conversation.issueSessionGrant).not.toHaveBeenCalled();
  });

  it("does not mint authority when owner access or project identity fails", async () => {
    const denied = ports();
    denied.authorized.mockResolvedValue(false);
    await expect(prepareVoiceToolDispatch(request(), denied)).rejects.toThrow(/owner/);
    expect(denied.sessionIdentity).not.toHaveBeenCalled();
    const foreign = ports();
    foreign.sessionIdentity.mockResolvedValue({ projectId: "project-b", provider: "codex" });
    await expect(prepareVoiceToolDispatch(request(), foreign)).rejects.toThrow(/another project/);
    expect(foreign.issuers.conversation.issueSessionGrant).not.toHaveBeenCalled();
  });

  it("delegates the exact verified scope and releases only its own sibling grant once", async () => {
    const p = ports();
    const dispatch = await prepareVoiceToolDispatch(request(), p);
    expect(p.issuers.conversation.issueSessionGrant).toHaveBeenCalledExactlyOnceWith(
      "session-a",
      "verified-owner-device-hash",
      {
        projectId: "project-a",
        provider: "codex",
        environmentId: "host-a",
        sessionId: "session-a",
      },
    );
    expect(dispatch.method).toBe("conversation.tools.call");
    const sibling = await prepareVoiceToolDispatch(request(), p);
    expect(dispatch.browserOwner).toBe(sibling.browserOwner);
    expect(dispatch.browserOwner).not.toContain(dispatch.token);
    const otherSession = await prepareVoiceToolDispatch(
      { ...request(), sessionId: "session-b" },
      p,
    );
    expect(otherSession.browserOwner).not.toBe(dispatch.browserOwner);
    expect(dispatch.params).toEqual({ action: "notes.create", input: request().input });
    dispatch.release();
    dispatch.release();
    expect(p.issuers.conversation.revokeSessionGrant).toHaveBeenCalledExactlyOnceWith(
      "private-request-bound-grant",
    );
    expect(p.issuers.social.revokeSessionGrant).not.toHaveBeenCalled();
    sibling.release();
    otherSession.release();
  });

  it("rechecks owner access after asynchronous grant creation and revokes on refusal", async () => {
    const p = ports();
    p.authorized.mockResolvedValueOnce(true).mockResolvedValue(false);
    await expect(prepareVoiceToolDispatch(request(), p)).rejects.toThrow(/revoked/);
    expect(p.issuers.conversation.revokeSessionGrant).toHaveBeenCalledExactlyOnceWith(
      "private-request-bound-grant",
    );
  });

  it("keeps social and read-only runtime-log authority isolated and preserves request IDs", async () => {
    const p = ports();
    const social = await prepareVoiceToolDispatch(
      {
        ...request(),
        family: "social",
        action: "accounts.list",
        input: {},
        requestId: "same-operation",
      },
      p,
    );
    expect(social.method).toBe("social.tools.call");
    expect(social.params.requestId).toBe("same-operation");
    expect(p.issuers.conversation.issueSessionGrant).not.toHaveBeenCalled();
    const logs = await prepareVoiceToolDispatch(
      {
        ...request(),
        family: "runtime-logs",
        action: "sources",
        input: {},
      },
      p,
    );
    expect(logs.method).toBe("runtimeLogs.tools.call");
    expect(p.issuers["runtime-logs"].issueSessionGrant).toHaveBeenCalledOnce();
    social.release();
    logs.release();
  });
});

it("accepts an exact account target only for a projectless social Room", () => {
  const call = { threadId: "room", accountId: "account-a", family: "social", action: "inbox.list", input: {} };
  expect(parseVoiceToolCall(call)).toMatchObject({ accountId: "account-a", threadId: "room" });
  expect(() => parseVoiceToolCall({ ...call, projectId: "project" })).toThrow();
  expect(() => parseVoiceToolCall({ ...call, sessionId: "session" })).toThrow();
  expect(() => parseVoiceToolCall({ ...call, family: "conversation" })).toThrow();
});
