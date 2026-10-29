import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  CommandDispatchParamsSchema,
  CommandReceiptSchema,
  SessionsListResultSchema,
  SessionsPageResultSchema,
  SessionSyncResponseSchema,
  parseHostRpcParams,
  exportHostContractManifest,
  getHostRpcMethod,
  hostRpcCost,
  hostRpcSupported,
  hostAuthorityDecisionDigestInput,
  HostAuthorityDecisionSchema,
  BulkDescriptorSchema,
  BulkResultSchema,
  WS_LIMITS,
} from "./index";

const base = { commandId: "command-a", sessionId: "session-a" };
it("lets only nested create first turns inherit an omitted session identity", () => {
  const create = {
    type: "create",
    commandId: "create-inherited",
    projectId: "project-a",
    harness: "codex",
    model: "model-a",
    runtimeMode: "supervised",
  };
  for (const type of ["send", "draft"]) {
    const firstTurn = { type, commandId: `first-${type}`, text: "hello" };
    expect(CommandDispatchParamsSchema.parse({ ...create, firstTurn })).toEqual({
      ...create,
      firstTurn,
    });
    expect(
      CommandDispatchParamsSchema.parse({
        ...create,
        sessionId: "allocated-a",
        firstTurn: { ...firstTurn, sessionId: "allocated-a" },
      }),
    ).toBeTruthy();
    expect(
      CommandDispatchParamsSchema.parse({ ...create, firstTurn: { ...firstTurn, sessionId: "" } }),
    ).toBeTruthy();
    expect(CommandDispatchParamsSchema.safeParse(firstTurn).success).toBe(false);
    expect(
      CommandDispatchParamsSchema.safeParse({
        ...create,
        firstTurn: { ...firstTurn, sessionId: null },
      }).success,
    ).toBe(false);
    expect(
      CommandDispatchParamsSchema.safeParse({
        ...create,
        firstTurn: { ...firstTurn, sessionId: "a".repeat(201) },
      }).success,
    ).toBe(false);
    expect(
      CommandDispatchParamsSchema.safeParse({
        ...create,
        firstTurn: { ...firstTurn, unexpected: true },
      }).success,
    ).toBe(false);
  }
});
describe("session wire contracts", () => {
  it("matches the native authority decision digest golden tuple", () => {
    const decision = HostAuthorityDecisionSchema.parse({
      protocol: 2,
      environmentId: "env-golden",
      sessionId: "session-golden",
      migrationId: "migration-golden",
      sourceProfileId: "profile-golden",
      sourceStoreId: "store-golden",
      receiptId: "receipt-golden",
      sourceGeneration: 7,
      authorityGeneration: 8,
      sourceRevision: 42,
      sourceDigest: "a".repeat(64),
      evidenceDigest: "b".repeat(64),
      minWriterProtocol: 2,
      committedAt: 1_700_000_000_000,
      phase: "aborted",
      decisionDigest: "a6598ffe23f231050ad53809356cef7d36ffd915da0cf540f05e28a5c3f3fc2a",
    });
    expect(
      createHash("sha256").update(hostAuthorityDecisionDigestInput(decision), "utf8").digest("hex"),
    ).toBe(decision.decisionDigest);
  });
  it("validates the actual command type union and closed nested input", () => {
    const commands = [
      { type: "send", text: "Türkçe 😀", intent: "plan" },
      { type: "draft", text: "draft" },
      { type: "steer", text: "steer", runId: "run-a" },
      { type: "configure", model: "model-a", modelSettings: {}, runtimeMode: "supervised" },
      {
        type: "configure",
        model: "model-a",
        modelSettings: {},
        runtimeMode: "supervised",
        providerAccountId: "host-account",
      },
      {
        type: "configure",
        model: "model-a",
        modelSettings: {},
        runtimeMode: "supervised",
        providerAccountId: null,
      },
      { type: "compact", resumeAtReset: true },
      { type: "removeDraft", draftBlockId: "block-a" },
      { type: "rewind", blockId: "block-a", expectedRevision: 4 },
      { type: "shell", line: "git status" },
      { type: "usageLimit", action: "disarm" },
      { type: "cancel", runId: "run-a" },
      { type: "stopItem", runId: "run-a", blockId: "block-a", callId: "call-a" },
      { type: "approve", runId: "run-a", requestId: 0, decision: "allow" },
      {
        type: "answer",
        runId: "run-a",
        requestId: 0,
        reply: { kind: "answered", answers: { question: ["yes"] } },
      },
      {
        type: "contextual",
        sourceBlockId: "block-a",
        expectedRevision: 2,
        mode: "handoff",
        harness: "codex",
        model: "model-a",
        modelSettings: {},
        previewDigest: "digest",
      },
    ];
    for (const command of commands)
      expect(CommandDispatchParamsSchema.parse({ ...base, ...command })).toEqual({
        ...base,
        ...command,
      });
    const create = {
      type: "create",
      commandId: "create-a",
      projectId: "project-a",
      harness: "codex",
      model: "model-a",
      runtimeMode: "supervised",
      firstTurn: { ...base, type: "send", text: "hello" },
    };
    expect(CommandDispatchParamsSchema.parse(create)).toEqual(create);
    for (const invalid of [
      { ...base, type: "stop", runId: "run-a" },
      { ...base, type: "steer", text: "missing run" },
      { ...base, type: "send", text: "x", arbitrary: { execute: true } },
      { ...base, type: "send", text: "x", modelSettings: {} },
      { ...base, type: "answer", runId: "run-a", requestId: 0.1, reply: { kind: "skipped" } },
      { ...create, firstTurn: { ...base, type: "cancel", runId: "run-a" } },
      {
        ...base,
        type: "send",
        text: "x",
        attachments: [
          {
            id: "attachment-a",
            name: "a",
            mimeType: "text/plain",
            kind: "file",
            size: 1,
            path: "outside",
          },
        ],
      },
    ])
      expect(CommandDispatchParamsSchema.safeParse(invalid).success).toBe(false);
  });

  it("preserves receipt identity, page/sync shapes and safe revisions", () => {
    expect(CommandReceiptSchema.parse({ ...base, revision: 9, runId: "run-a" })).toEqual({
      ...base,
      revision: 9,
      runId: "run-a",
    });
    expect(
      CommandReceiptSchema.safeParse({ ...base, revision: Number.MAX_SAFE_INTEGER + 1 }).success,
    ).toBe(false);
    for (const result of [[], { unchanged: true, etag: "etag" }, { sessions: [], etag: "etag" }])
      expect(SessionsListResultSchema.parse(result)).toEqual(result);
    expect(SessionSyncResponseSchema.parse({ kind: "unchanged", revision: 7 })).toEqual({
      kind: "unchanged",
      revision: 7,
    });
    const page = {
      totalBlocks: 0,
      revision: 7,
      sync: { kind: "chunked", transfer: "transfer-a", length: 100 },
    };
    expect(SessionsPageResultSchema.parse(page)).toEqual(page);
    expect(SessionsPageResultSchema.safeParse({ ...page, value: {} }).success).toBe(false);
    expect(() =>
      parseHostRpcParams("sessions.sync", { sessionId: "session-a", revision: "7" }),
    ).toThrow();
  });

  it("keeps queue reconciliation distinct from replayable reads", () => {
    const params = {
      sessionId: "session-a",
      clientId: "desktop:window-a",
      leaseAware: true,
      epoch: 4,
    };
    expect(parseHostRpcParams("sessions.queue.get", params)).toEqual(params);
    expect(
      parseHostRpcParams("sessions.queue.change", {
        ...params,
        before: { revision: 2, messages: [] },
        after: { revision: 2, messages: [], status: "active" },
      }),
    ).toMatchObject({ after: { messages: [], status: "active" } });
    expect(() =>
      parseHostRpcParams("sessions.queue.finish", { ...params, token: "claim-a", accepted: "yes" }),
    ).toThrow();
    expect(getHostRpcMethod("sessions.queue.get")).toMatchObject({
      kind: "control",
      retry: "never",
      cancellation: "wait-only",
    });
    expect(hostRpcCost("sessions.queue.get", params)).toBe("read");
    expect(hostRpcCost("sessions.queue.change", params)).toBe("read");
    expect(hostRpcCost("commands.dispatch", { type: "send" })).toBe("read");
    expect(hostRpcCost("commands.dispatch", { type: "cancel" })).toBe("control");
    expect(hostRpcCost("commands.status", { commandId: "command-a" })).toBe("control");
    expect(getHostRpcMethod("commands.dispatch")).toMatchObject({ retry: "receipt-lookup" });
    const queued = {
      id: "message-a",
      clientId: "desktop:window-a",
      revision: 2,
      leaseAware: true,
      epoch: 4,
    };
    expect(
      parseHostRpcParams("commands.dispatch", { ...base, type: "send", text: "hello", queued }),
    ).toMatchObject({ queued });
    const manifest = exportHostContractManifest();
    expect(JSON.stringify(manifest)).toBe(JSON.stringify(exportHostContractManifest()));
  });

  it("validates credential-free bounded bulk indirection before HTTP resolution", () => {
    const descriptor = {
      kind: "bulk",
      transferId: "transfer-a",
      environmentId: "environment-a",
      totalBytes: 1_000_000,
      chunkBytes: WS_LIMITS.streamChunkBytes,
      sha256: "a".repeat(64),
      expiresAt: 1_800_000_000_000,
    };
    expect(BulkDescriptorSchema.parse(descriptor)).toEqual(descriptor);
    expect(BulkResultSchema.parse({ $bulk: descriptor })).toEqual({ $bulk: descriptor });
    for (const change of [
      { token: "secret" },
      { url: "http://other" },
      { chunkBytes: 0 },
      { chunkBytes: WS_LIMITS.streamChunkBytes + 1 },
      { sha256: "A".repeat(64) },
      { sha256: "a".repeat(64) + "\n" },
      { totalBytes: Number.MAX_SAFE_INTEGER + 1 },
    ])
      expect(BulkDescriptorSchema.safeParse({ ...descriptor, ...change }).success).toBe(false);
    expect(BulkResultSchema.safeParse({ $bulk: descriptor, result: {} }).success).toBe(false);
    expect(JSON.stringify(exportHostContractManifest())).toContain('"bulkDescriptor"');
  });
  it("requires the advertised method family even when its local schema is known", () => {
    const capabilities = ["transport.ws.read.v2", "transport.ws.sessions.v2"];
    expect(hostRpcSupported("projects.list", capabilities)).toBe(true);
    expect(hostRpcSupported("commands.dispatch", capabilities)).toBe(true);
    expect(hostRpcSupported("sessions.queue.get", capabilities)).toBe(false);
    expect(hostRpcSupported("sessions.queue.get", [...capabilities, "transport.ws.queue.v2"])).toBe(
      true,
    );
    expect(hostRpcSupported("subscriptions.open", capabilities)).toBe(false);
    expect(hostRpcSupported("subscriptions.open", ["transport.ws.streams.v2"])).toBe(true);
    expect(hostRpcSupported("connection.hello", [])).toBe(true);
    expect(hostRpcSupported("unknown.method", capabilities)).toBe(false);
  });
});
