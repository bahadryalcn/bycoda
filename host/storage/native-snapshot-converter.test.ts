import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  createNativeSnapshotConverter,
  NativeMigrationTargetSchema,
  NativeSnapshotConversionError,
  NATIVE_SNAPSHOT_CONVERTER_VERSION,
  projectNativeMigrationHostSession,
  validateNativeMigrationTarget,
  type NativeMigrationTarget,
} from "./native-snapshot-converter";
import type { JsonValue } from "../../src/shared/model/host-contracts/schemas";
import type { NativeFenceEvidence } from "../../src/shared/model/host-contracts/authority";
import { SessionViewSchema } from "../../src/shared/model/host-contracts/session-reads";

const captured = JSON.parse(
  readFileSync(new URL("./fixtures/native-snapshot-v1.json", import.meta.url), "utf8"),
) as { sourceJson: string; fence: NativeFenceEvidence };
const options = { projectId: "project.native-fixture", expectedCwd: "/fixture/native-project" };
type Source = {
  session: Record<string, any>;
  clientOwnedQueue: any;
  clientOwnedDraftJson: string | null;
  retainedNativeRows: Record<string, Array<Record<string, any>>>;
};
function source(): Source {
  return JSON.parse(captured.sourceJson) as Source;
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function convert(
  value: unknown = source(),
  fence: NativeFenceEvidence = captured.fence,
): NativeMigrationTarget {
  return createNativeSnapshotConverter(options).convert(
    value as JsonValue,
    fence,
  ) as NativeMigrationTarget;
}
function rich(): Source {
  // Synthetic feature-rich extension of the real native row layout. SQL and
  // record representations are updated together; no native actor is asserted.
  const value = source();
  const s = value.session;
  Object.assign(s, {
    providerSessionId: "provider.resume.1",
    providerAccountId: "account.native",
    modelSettings: { reasoning: "high" },
    contextUsed: 1234,
    contextWindow: 200000,
    branch: "feature/native",
    worktreeCwd: "/fixture/native-project/.worktrees/retained",
    workspaceMode: "worktree",
    workspaceId: "workspace.native",
    workspaceRevision: 7,
    automationId: "automation.native",
    linkedWorkItem: {
      kind: "issue",
      repo: "fixture/repository",
      number: 42,
      url: "https://example.invalid/issue/42",
    },
    pendingContextReplay: "exact retained replay\n",
    transcriptRevision: 8,
    adoptedBase: '{ "count":1, "chain":"' + "b".repeat(64) + '" }',
    adoptedDivergence:
      '{ "key":"conflict-identity", "keep":true, "hostHead":{"count":1,"chain":"' +
      "a".repeat(64) +
      '"} }',
    orchestrationLeadId: "lead.native",
  });
  const attachment = {
    id: "attachment.1",
    name: "original.png",
    mimeType: "image/png",
    kind: "image",
    size: 3,
    path: "/fixture/native-project/original.png",
    data: "YWJj",
    hostEnvironmentId: "native-converter-fixture",
    missing: false,
  };
  s.blocks = [
    {
      id: "turn.1",
      role: "user",
      text: "preserved user text",
      attachments: [attachment],
      startedAt: 1700000000010,
      turnModel: { harness: "codex", id: "recorded-model", name: "Original model" },
      turnMetrics: { inputTokens: 200, outputTokens: 25 },
      questionAnswers: [{ prompt: "Question", answers: ["Retained answer"] }],
      ciContext: "exact evidence",
      nativeFeatureExtension: { retained: true },
    },
    {
      id: "tool.1",
      role: "tool",
      text: "result",
      tool: {
        callId: "call.native",
        title: "Actual command",
        status: "completed",
        detail: "exact output",
      },
      approval: { requestId: 3, decided: "allow" },
      agentRun: { name: "review", steps: [{ id: "step.1", kind: "command", text: "recorded" }] },
      shell: { command: "echo retained", cwd: "/fixture/native-project", exitCode: 0 },
    },
    {
      id: "answer.1",
      role: "assistant",
      text: "retained response",
      durationMs: 400,
      notice: "info",
    },
  ];
  s.rewindHistory = [
    {
      id: "rewind.1",
      createdAt: 1700000000005,
      fromBlockId: "old.user",
      blocks: [
        { id: "old.user", role: "user", text: "archived original", attachments: [attachment] },
      ],
    },
  ];
  const r = value.retainedNativeRows;
  const saved = r.sessions[0];
  Object.assign(saved, {
    provider_session_id: s.providerSessionId,
    provider_account_id: s.providerAccountId,
    model_settings: JSON.stringify(s.modelSettings),
    context_used: s.contextUsed,
    context_window: s.contextWindow,
    branch: s.branch,
    worktree_cwd: s.worktreeCwd,
    workspace_mode: s.workspaceMode,
    workspace_id: s.workspaceId,
    workspace_revision: s.workspaceRevision,
    automation_id: s.automationId,
    linked_work_item_json: JSON.stringify(s.linkedWorkItem),
    rewind_history_json: JSON.stringify(s.rewindHistory),
    pending_context_replay: s.pendingContextReplay,
    adopted_base: s.adoptedBase,
    adopted_divergence: s.adoptedDivergence,
    archived: 1,
    pinned: 1,
  });
  r.session_blocks = s.blocks.map((block: any, ordinal: number) => ({
    session_id: s.id,
    ordinal,
    block_id: block.id,
    block_json: JSON.stringify(block),
    revision: 8,
  }));
  r.session_block_state = [{ session_id: s.id, length: s.blocks.length, revision: 8 }];
  r.in_flight_sessions = [{ session_id: s.id, cwd: s.cwd, sort_index: 0 }]; // Open-tab recovery roster, not a provider run.
  r.orchestration_workers = [
    { session_id: s.id, lead_id: s.orchestrationLeadId },
    { session_id: "worker.native", lead_id: s.id },
  ];
  r.orchestration_runs = [
    { lead_id: s.id, state: '{"phase":"complete","original":"run evidence"}' },
  ];
  r.orchestration_sidebar = [{ lead_id: s.id, summary: '{"retained":"sidebar"}' }];
  for (const table of [
    "session_rewind_operations",
    "native_managed_turns",
    "native_rewind_requests",
    "native_rewind_intents",
  ])
    r[table] = [
      {
        session_id: s.id,
        id: table + ".old",
        phase: "complete",
        original_blob: { encoding: "base64", bytes: "YWJj" },
      },
    ];
  value.clientOwnedQueue = [
    {
      id: "queued.native",
      text: " never dispatch automatically ",
      attachments: [attachment],
      deliveryUnknown: true,
      authorityGeneration: 1,
      intent: "orchestrate",
      noteCard: { id: "note.1", body: "retained note" },
      modelTarget: {
        harness: "claude",
        model: "recorded-model",
        modelSettings: { effort: "high" },
        providerAccountId: "original-account",
      },
    },
  ];
  value.clientOwnedDraftJson =
    JSON.stringify(
      {
        text: "unsent\n",
        attachments: [attachment],
        mode: "save",
        mcpTags: [
          {
            token: "@mcp/retained",
            server: {
              name: "retained",
              provider: "codex",
              scope: "project",
              transport: "stdio",
              command: "retained.exe",
              args: [],
            },
          },
        ],
      },
      null,
      2,
    ) + "\n";
  r.session_queues = [
    {
      session_id: s.id,
      queue_json: JSON.stringify(value.clientOwnedQueue, null, 2) + "\n",
      updated_at: s.updatedAt,
    },
  ];
  r.composer_drafts = [
    { session_id: s.id, draft_json: value.clientOwnedDraftJson, updated_at: s.updatedAt },
  ];
  return clone(value);
}
function richFence(value: Source): NativeFenceEvidence {
  return { ...captured.fence, sourceRevision: value.session.transcriptRevision };
}

describe("production native snapshot converter", () => {
  it.each(["job","manual"])("retains %s assistant management and message authors only when the native source rows agree",scope=>{
    const value=rich();const source=scope==="job"?{jobId:"assistant-job"}:{supervisionId:"manual-grant"};const management={assistant:true,...source,managedAt:123};
    value.session.managedBy=management;
    value.retainedNativeRows.sessions[0].assistant_management_json=JSON.stringify(management);
    const author={kind:scope==="job"?"assistant":"assistant-manual",name:"Owner Name",...source,reason:"nudge",operationId:"original-effect"};
    value.session.blocks[0].author=author;
    value.retainedNativeRows.session_blocks[0].block_json=JSON.stringify(value.session.blocks[0]);
    const converted=convert(value,richFence(value));
    expect(converted.hostSession.session.managedBy).toEqual(management);
    expect(converted.hostSession.session.blocks[0].author).toEqual(author);
    const mismatch=clone(value);mismatch.retainedNativeRows.sessions[0].assistant_management_json=JSON.stringify({...management,...(scope==="job"?{jobId:"forged"}:{supervisionId:"forged"})});
    expect(()=>convert(mismatch,richFence(mismatch))).toThrow("metadata disagrees");
  });
  it("converts the real-native-derived serialized fixture and preserves its complete source layout", () => {
    expect(createHash("sha256").update(captured.sourceJson).digest("hex")).toBe(
      captured.fence.sourceDigest,
    );
    const original = source();
    const target = convert(original);
    expect(target.kind).toBe("native-session-target");
    expect(target.hostSession).toMatchObject({
      projectId: options.projectId,
      status: "idle",
      revision: 1,
      authorityGeneration: captured.fence.generation,
      createdAt: original.session.createdAt,
      updatedAt: original.session.updatedAt,
      archived: false,
      pinned: false,
    });
    expect(target.hostSession.session.blocks).toEqual(original.session.blocks);
    expect(target.nativePreservation.retainedNativeRows).toEqual(original.retainedNativeRows);
    expect(target.nativePreservation.recordProjection).toEqual(
      Object.fromEntries(Object.entries(original.session).filter(([key]) => key !== "blocks")),
    );
    expect(validateNativeMigrationTarget(target)).toEqual(target);
  });

  it("preserves rich history, account/workspace provenance and exact private client state without replay", () => {
    const original = rich();
    const target = convert(original, richFence(original));
    expect(target.hostSession.session).toMatchObject({
      providerSessionId: original.session.providerSessionId,
      providerAccountId: original.session.providerAccountId,
      workspaceId: original.session.workspaceId,
      workspaceRevision: 7,
      modelSettings: { reasoning: "high" },
      context: { used: 1234, window: 200000 },
      orchestrationLeadId: "lead.native",
      pendingContextReplay: original.session.pendingContextReplay,
      rewindHistory: original.session.rewindHistory,
    });
    expect(target.hostSession.session.blocks).toEqual(original.session.blocks);
    expect(target.hostSession.session.adoptedBase).toEqual(
      JSON.parse(original.session.adoptedBase),
    );
    expect(target.nativePreservation.recordProjection.adoptedBase).toBe(
      original.session.adoptedBase,
    );
    expect(target.nativePreservation.clientOwnedDraftJson).toBe(original.clientOwnedDraftJson);
    expect(target.nativePreservation.clientOwnedQueue).toEqual(original.clientOwnedQueue);
    expect(target.nativePreservation.retainedNativeRows).toEqual(original.retainedNativeRows);
    expect(target.hostSession).not.toHaveProperty("runId");
    expect(target.hostSession).not.toHaveProperty("desktop");
    expect(target.hostSession).not.toHaveProperty("executionOwner");
    expect(target.hostSession.session).not.toHaveProperty("queuedMessages");
    expect(target.hostSession.session).not.toHaveProperty("busy");
    expect(target.hostSession.status).toBe("idle");
    const projected = projectNativeMigrationHostSession(target);
    expect(SessionViewSchema.safeParse(projected).success).toBe(true);
    expect(SessionViewSchema.safeParse(target).success).toBe(false);
    expect(JSON.stringify(projected)).not.toContain("@mcp/retained");
    expect(JSON.stringify(projected)).not.toContain("never dispatch automatically");
    expect(validateNativeMigrationTarget(target)).toEqual(target);
  });

  it("is deterministic across property ordering, pure, versioned and detached from caller objects", () => {
    const original = rich();
    const reverse = (value: any): any =>
      Array.isArray(value)
        ? value.map(reverse)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.keys(value)
                .reverse()
                .map((key) => [key, reverse(value[key])]),
            )
          : value;
    const before = JSON.stringify(original);
    const first = convert(original, richFence(original));
    const second = convert(reverse(original), richFence(original));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(original)).toBe(before);
    expect(createNativeSnapshotConverter(options).version).toBe(NATIVE_SNAPSHOT_CONVERTER_VERSION);
    (first.hostSession.session.blocks[0] as any).text = "changed returned clone";
    expect(original.session.blocks[0].text).toBe("preserved user text");
  });

  it("supports the native legacy transcript fallback while retaining stale incremental rows verbatim", () => {
    const original = rich();
    original.retainedNativeRows.session_block_state[0].length = -1;
    original.retainedNativeRows.sessions[0].blocks_json = JSON.stringify(original.session.blocks);
    original.retainedNativeRows.session_blocks[0].block_json =
      "stale malformed row must stay opaque";
    const target = convert(original, richFence(original));
    expect(target.nativePreservation.retainedNativeRows.session_blocks).toEqual(
      original.retainedNativeRows.session_blocks,
    );
    expect(target.hostSession.session.blocks).toEqual(original.session.blocks);
  });

  it("supports a legacy full checkpoint with no incremental revision without inventing a stream revision", () => {
    const original = source();
    delete original.session.transcriptRevision;
    original.retainedNativeRows.session_block_state = [];
    original.retainedNativeRows.session_blocks = [];
    original.retainedNativeRows.sessions[0].blocks_json = JSON.stringify(original.session.blocks);
    const target = convert(original, { ...captured.fence, sourceRevision: 0 });
    expect(target.hostSession.revision).toBe(0);
    expect(target.hostSession.session.blocks).toEqual(original.session.blocks);
    expect(target.nativePreservation.recordProjection).not.toHaveProperty("transcriptRevision");
  });

  it("blocks a window-only context observation instead of dropping it or inventing used tokens", () => {
    const original = source();
    original.session.contextWindow = 200000;
    original.retainedNativeRows.sessions[0].context_window = 200000;
    expect(() => convert(original)).toThrow(/used-token observation/);
    expect(original.session.contextWindow).toBe(200000);
  });

  it("preserves a legacy private draft without inventing missing MCP tags", () => {
    const value = source();
    value.clientOwnedDraftJson = '{ "text":"legacy unsent", "attachments":[] }\n';
    value.retainedNativeRows.composer_drafts = [
      {
        session_id: value.session.id,
        draft_json: value.clientOwnedDraftJson,
        updated_at: value.session.updatedAt,
      },
    ];
    const target = convert(value);
    expect(target.nativePreservation.clientOwnedDraftJson).toBe(value.clientOwnedDraftJson);
    expect(JSON.parse(target.nativePreservation.clientOwnedDraftJson!)).not.toHaveProperty(
      "mcpTags",
    );
    expect(target.hostSession.session).not.toHaveProperty("composerSeed");
  });

  const malformed: Record<string, (value: Source) => void> = {
    "unknown envelope field": (value) => {
      (value as any).unexpected = true;
    },
    "unknown native record field": (value) => {
      value.session.pendingSwitch = { from: "codex" };
    },
    "unknown retained table": (value) => {
      value.retainedNativeRows.future_operations = [];
    },
    "unsupported provider": (value) => {
      value.session.harness = "gemini";
    },
    "unsupported runtime policy": (value) => {
      value.session.runtimeMode = "approve";
    },
    "lost history block": (value) => {
      value.session.blocks = [];
    },
    "duplicate block": (value) => {
      value.session.blocks.push(clone(value.session.blocks[0]));
    },
    "streaming block": (value) => {
      value.session.blocks[0].streaming = true;
    },
    "remote preview": (value) => {
      value.session.blocks[0].remoteContent = { revision: 1, bytes: 100 };
    },
    "native session conflict": (value) => {
      value.retainedNativeRows.sessions[0].title = "different";
    },
    "missing optional SQL column": (value) => {
      delete value.retainedNativeRows.sessions[0].provider_account_id;
    },
    "temporary Inbox row": (value) => {
      value.retainedNativeRows.sessions[0].inbox_ask = '{"issue":"temporary"}';
    },
    "unsent draft session": (value) => {
      value.retainedNativeRows.sessions[0].is_draft = 1;
    },
    "blank ephemeral session": (value) => {
      value.retainedNativeRows.sessions[0].has_user_message = 0;
    },
    "draft block and native metadata conflict": (value) => {
      value.session.blocks[0].draft = true;
      value.retainedNativeRows.session_blocks[0].block_json = JSON.stringify(
        value.session.blocks[0],
      );
    },
    "duplicate session row": (value) => {
      value.retainedNativeRows.sessions.push(clone(value.retainedNativeRows.sessions[0]));
    },
    "foreign retained row": (value) => {
      value.retainedNativeRows.in_flight_sessions = [
        { session_id: "foreign", cwd: options.expectedCwd, sort_index: 0 },
      ];
    },
    "missing transcript row": (value) => {
      value.retainedNativeRows.session_blocks = [];
    },
    "wrong transcript ordinal": (value) => {
      value.retainedNativeRows.session_blocks[0].ordinal = 1;
    },
    "wrong transcript revision": (value) => {
      value.retainedNativeRows.session_blocks[0].revision = 2;
    },
    "invalid embedded transcript": (value) => {
      value.retainedNativeRows.session_blocks[0].block_json = "{";
    },
    "invalid retained queue": (value) => {
      value.retainedNativeRows.session_queues = [
        { session_id: value.session.id, queue_json: "broken-json", updated_at: 1 },
      ];
    },
    "lost parsed queue": (value) => {
      value.retainedNativeRows.session_queues = [
        { session_id: value.session.id, queue_json: "[]", updated_at: 1 },
      ];
    },
    "draft mismatch": (value) => {
      value.clientOwnedDraftJson = '{"text":"lost"}';
    },
    "unfinished native operation": (value) => {
      value.retainedNativeRows.native_managed_turns = [
        { session_id: value.session.id, phase: "running" },
      ];
    },
    "corrupt optional feature": (value) => {
      value.retainedNativeRows.sessions[0].rewind_history_json = "invalid";
    },
    "unsafe counter": (value) => {
      value.session.updatedAt = Number.MAX_SAFE_INTEGER + 1;
    },
    "negative zero": (value) => {
      value.retainedNativeRows.sessions[0].archived = -0;
    },
    "invalid Unicode": (value) => {
      value.session.title = "\ud800";
    },
    "malformed blob": (value) => {
      value.retainedNativeRows.sessions[0].extra_blob = { encoding: "base64", bytes: "not base64" };
    },
  };
  it.each(Object.entries(malformed))("blocks %s without modifying source", (_name, mutate) => {
    const original = source();
    mutate(original);
    const before = JSON.stringify(original);
    expect(() => convert(original)).toThrow(NativeSnapshotConversionError);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("blocks an embedded numeric value that JSON.parse would round silently", () => {
    const original = source();
    original.session.blocks[0].nativeMetric = 1;
    original.retainedNativeRows.session_blocks[0].block_json = JSON.stringify(
      original.session.blocks[0],
    ).replace('"nativeMetric":1', '"nativeMetric":1.00000000000000001');
    expect(() => convert(original)).toThrow(/precision/);
  });

  it("blocks malformed graph inputs before executing accessors or serialization hooks", () => {
    let accessed = false;
    const value = source();
    Object.defineProperty(value, "getter", {
      enumerable: true,
      get() {
        accessed = true;
        return 1;
      },
    });
    expect(() => convert(value)).toThrow();
    expect(accessed).toBe(false);
    const cyclic: any = source();
    cyclic.self = cyclic;
    expect(() => convert(cyclic)).toThrow();
    const sparse = source();
    sparse.session.blocks = [];
    sparse.session.blocks.length = 3;
    expect(() => convert(sparse)).toThrow();
  });

  it("requires the captured project/cwd and the exact supported native fence scope/revision", () => {
    expect(() =>
      createNativeSnapshotConverter({ projectId: "", expectedCwd: options.expectedCwd }),
    ).toThrow();
    expect(() =>
      createNativeSnapshotConverter({
        ...options,
        expectedCwd: options.expectedCwd + "/other",
      }).convert(source() as JsonValue, captured.fence),
    ).toThrow();
    for (const fence of [
      { ...captured.fence, sessionId: "foreign" },
      { ...captured.fence, sourceRevision: 99 },
      { ...captured.fence, minWriterProtocol: 3 },
      { ...captured.fence, unknownReservations: true },
    ])
      expect(() => convert(source(), fence as NativeFenceEvidence)).toThrow(
        NativeSnapshotConversionError,
      );
  });

  it("blocks unsupported target changes and never projects private preservation data", () => {
    const target = convert();
    expect(NativeMigrationTargetSchema.safeParse(target).success).toBe(true);
    for (const change of [
      (value: any) => {
        value.hostSession.session.title = "different";
      },
      (value: any) => {
        value.hostSession.runId = "invented";
      },
      (value: any) => {
        value.hostSession.session.queuedMessages = [];
      },
      (value: any) => {
        value.nativePreservation.clientOwnedQueue = [];
      },
      (value: any) => {
        value.hostSession.status = "running";
      },
    ]) {
      const changed = clone(target);
      change(changed);
      expect(() => validateNativeMigrationTarget(changed)).toThrow(NativeSnapshotConversionError);
      expect(() => projectNativeMigrationHostSession(changed)).toThrow(
        NativeSnapshotConversionError,
      );
    }
  });

  it("blocks oversized source/target rather than truncating retained data", () => {
    const value = source();
    value.session.title = "x".repeat(32 * 1024 * 1024);
    expect(() => convert(value)).toThrow(/32 MiB/);
    const target = convert();
    (target.nativePreservation.retainedNativeRows.sessions[0] as any).unmapped = "x".repeat(
      32 * 1024 * 1024,
    );
    expect(() => validateNativeMigrationTarget(target)).toThrow(/32 MiB/);
  });

  it("blocks preservation overhead that exceeds the target limit even when the source fits", () => {
    const value = source();
    value.session.title = "x".repeat(12 * 1024 * 1024);
    value.retainedNativeRows.sessions[0].title = value.session.title;
    expect(Buffer.byteLength(JSON.stringify(value), "utf8")).toBeLessThan(32 * 1024 * 1024);
    expect(() => convert(value)).toThrow(/32 MiB/);
    expect(value.session.title.length).toBe(12 * 1024 * 1024);
  });
});
