// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { newSession, type Block, type Session } from "../../sessions/model/session";
import { ParentInputRegistry } from "../../sessions/data/parentInputClosure";
import { createApprovalIntentRegistry } from "../../sessions/model/approvalIntents";
import { registerRemoteSessionActions } from "./remoteSessionActions";
import { applyHarnessEvent } from "../../../integrations/harness/core/apply";
import { createApprovalOccurrenceId } from "../../../shared/model/approvalOccurrence";
import {
  applyDesktopLiveCommand,
  executeDesktopInboxOperation,
  buildDesktopLiveSessions,
  runDesktopLiveTick,
  supportsDesktopLive,
  type DesktopLiveCommand,
  type DesktopLivePayload,
  type DesktopLiveHandlers,
} from "./desktopLive";

const native = vi.hoisted(() => ({
  approve: vi.fn(),
  adapter: { respondApproval: vi.fn() },
}));
vi.mock("../../../integrations/harness", () => ({
  getHarness: () => native.adapter,
  // The production Native bridge returns void, without a provider-consumption ACK.
  respondHarnessApproval: (...args: unknown[]) => {
    native.approve(...args);
  },
}));
beforeEach(() => {
  native.approve.mockClear();
  native.adapter = { respondApproval: vi.fn() };
});

it("dispatches review context and inline review batches through the finite native bridge", async () => {
  const runner = { invoke: vi.fn().mockResolvedValue("url"), list: vi.fn() };
  const item = {
    provider: "github" as const,
    kind: "pr" as const,
    repo: "owner/repo",
    number: 7,
    projectPath: "/project",
  };
  await executeDesktopInboxOperation({ action: "review-context", cwd: "/project", item }, runner);
  expect(runner.invoke).toHaveBeenLastCalledWith("git_github_pr_review_context", {
    cwd: "/project",
    repo: "owner/repo",
    number: 7,
  });
  const review = {
    commitId: "a".repeat(40),
    event: "COMMENT" as const,
    body: "Şuraya bakalım.",
    comments: [{ path: "a.ts", line: 3, side: "RIGHT" as const, body: "Kontrol eksik." }],
  };
  const deadline = Date.now() + 60_000;
  await executeDesktopInboxOperation(
    { action: "review", cwd: "/project", item, ...review },
    runner,
    deadline,
  );
  expect(runner.invoke).toHaveBeenLastCalledWith("desktop_inbox_review", {
    operation: { action: "review", cwd: "/project", item, ...review },
    deadline,
  });
  runner.invoke.mockClear();
  for (const invalid of [undefined, Date.now() - 1, Date.now() + 130_000])
    await expect(
      executeDesktopInboxOperation(
        { action: "review", cwd: "/project", item, ...review },
        runner,
        invalid,
      ),
    ).rejects.toThrow(/deadline/);
  expect(runner.invoke).not.toHaveBeenCalled();
});

const approvalBlock = (requestId: number, decided?: "allow"): Block =>
  ({
    id: `b${requestId}`,
    role: "tool",
    approval: { requestId, decided, occurrenceId: createApprovalOccurrenceId() },
  }) as unknown as Block;

const session = (over: Partial<Session> & { id: string }): Session =>
  ({ blocks: [], busy: false, ...over }) as unknown as Session;

const question = {
  requestId: 7,
  questions: [],
} as unknown as Session["pendingQuestion"];

it("holds a returned desktop stop when original turn changes during page verification", async () => {
  let current = true;
  const receipt = { version: 1 as const, sessionId: "s", turnId: "turn-a" };
  const stop = vi.fn();
  const unacked = new Set<string>();
  await runDesktopLiveTick({
    sessions: () => [session({ id: "s", busy: true })],
    handlers: { stop, approve: vi.fn(), answer: vi.fn() },
    handled: new Set(),
    unacked,
    controlGuard: {
      pageToken: async () => "page",
      capture: () => ({ receipt, question: undefined, current: () => current }),
      verify: async () => {
        current = false;
      },
    },
    request: async () => ({
      commands: [
        { id: "old", sessionId: "s", type: "cancel", pageToken: "page", turnReceipt: receipt },
      ],
    }),
  });
  expect(stop).not.toHaveBeenCalled();
  expect(unacked.size).toBe(0);
});

describe("buildDesktopLiveSessions", () => {
  it("selects busy sessions and ones needing input, skipping idle", () => {
    const out = buildDesktopLiveSessions([
      session({ id: "idle" }),
      session({ id: "busy", busy: true }),
      session({
        id: "appr",
        blocks: [approvalBlock(3), approvalBlock(4, "allow")],
      }),
      session({ id: "q", pendingQuestion: question }),
      session({ id: "gone", busy: true, worktreeRemoved: true } as never),
    ]);
    expect(out.map((s) => s.id)).toEqual(["busy", "appr", "q"]);
    expect(out[0]).toEqual({ id: "busy", busy: true });
    expect(out[1].busy).toBe(false);
    expect(out[1].pending?.map((b) => b.approval?.requestId)).toEqual([3]);
    expect(out[2].patch).toEqual({ pendingQuestion: question });
  });

  it("strips non-JSON values", () => {
    const block = {
      ...approvalBlock(1),
      fn: () => 1,
      nope: undefined,
    } as unknown as Block;
    const [entry] = buildDesktopLiveSessions([session({ id: "a", blocks: [block] })]);
    expect(entry.pending?.[0]).not.toHaveProperty("fn");
    expect(entry.pending?.[0]).not.toHaveProperty("nope");
  });
});

describe("applyDesktopLiveCommand", () => {
  const handlers = () => {
    const parent = new ParentInputRegistry();
    const registry = createApprovalIntentRegistry({
      register: (adapter) => parent.register(adapter),
    });
    return {
      stop: vi.fn(),
      approve: vi.fn<DesktopLiveHandlers["approve"]>((sessionId, requestId, decision, expected) =>
        registry.submitApprovalIntent(
          sessions.find((value) => value.id === sessionId),
          requestId,
          decision,
          expected,
        ),
      ),
      answer: vi.fn(),
      captureApproval: registry.captureApprovalRequest,
      approvalDispatchStarted: registry.approvalRequestDispatchStarted,
    };
  };
  const sessions = [
    session({
      ...newSession("codex", "G:/desktop-fixture"),
      id: "s",
      busy: true,
      blocks: [approvalBlock(3)],
      pendingQuestion: question,
    }),
    session({ id: "idle" }),
  ];

  it("maps cancel, approve and answer to the local handlers", () => {
    const h = handlers();
    expect(applyDesktopLiveCommand({ id: "1", sessionId: "s", type: "cancel" }, sessions, h)).toBe(
      true,
    );
    expect(h.stop).toHaveBeenCalledWith("s");
    expect(
      applyDesktopLiveCommand(
        {
          id: "2",
          sessionId: "s",
          type: "approve",
          requestId: 3,
          decision: "deny",
          approvalOccurrenceId: sessions[0].blocks[0].approval!.occurrenceId,
        },
        sessions,
        h,
      ),
    ).toBe(true);
    expect(h.approve).toHaveBeenCalledWith("s", 3, "deny", expect.any(Object));
    const reply = { kind: "skipped" } as const;
    applyDesktopLiveCommand(
      { id: "3", sessionId: "s", type: "answer", requestId: 7, reply },
      sessions,
      h,
    );
    expect(h.answer).toHaveBeenCalledWith("s", 7, reply);
  });

  it("drops stale commands", () => {
    const h = handlers();
    expect(
      applyDesktopLiveCommand({ id: "1", sessionId: "idle", type: "cancel" }, sessions, h),
    ).toBe(false);
    expect(
      applyDesktopLiveCommand({ id: "2", sessionId: "none", type: "cancel" }, sessions, h),
    ).toBe(false);
    expect(
      applyDesktopLiveCommand(
        {
          id: "3",
          sessionId: "s",
          type: "approve",
          requestId: 99,
          decision: "allow",
        },
        sessions,
        h,
      ),
    ).toBe(false);
    expect(
      applyDesktopLiveCommand(
        {
          id: "4",
          sessionId: "s",
          type: "answer",
          requestId: 8,
          reply: { kind: "skipped" },
        },
        sessions,
        h,
      ),
    ).toBe(false);
    expect(h.stop).not.toHaveBeenCalled();
    expect(h.approve).not.toHaveBeenCalled();
    expect(h.answer).not.toHaveBeenCalled();
  });
});

describe("desktop live exact local approval source", () => {
  function fixture(limits?: { records: number }) {
    let value = newSession("codex", "G:/desktop-original");
    value.blocks = [{ ...approvalBlock(71), text: "  original request\r\n漢🦀  " }];
    const parent = new ParentInputRegistry();
    const registry = createApprovalIntentRegistry({
      register: (adapter) => parent.register(adapter),
      limits,
    });
    const handlers = {
      stop: vi.fn(),
      answer: vi.fn(),
      captureApproval: vi.fn(registry.captureApprovalRequest),
      approvalDispatchStarted: registry.approvalRequestDispatchStarted,
      approve: vi.fn<DesktopLiveHandlers["approve"]>((_sessionId, requestId, decision, expected) =>
        registry.submitApprovalIntent(value, requestId, decision, expected, () => value),
      ),
    };
    const command: DesktopLiveCommand = {
      id: "original-command",
      sessionId: value.id,
      type: "approve",
      requestId: 71,
      decision: "allow",
      approvalOccurrenceId: value.blocks[0].approval!.occurrenceId,
    };
    return {
      handlers,
      registry,
      parent,
      approvalOccurrenceSupported: true,
      command,
      get value() {
        return value;
      },
      replace(next: Session) {
        value = next;
      },
      sessions: () => [value],
      unacked: new Set<string>(),
      handled: new Set<string>(),
    };
  }

  it("passes a real pre-await token to the actual central consumer and never replays its void outcome", async () => {
    const f = fixture();
    const request = vi.fn(async (payload: DesktopLivePayload) => {
      expect(f.handlers.captureApproval).toHaveBeenCalledExactlyOnceWith(
        f.value,
        71,
        f.value.blocks[0],
      );
      expect(payload.sessions[0].pending?.[0]).toEqual(f.value.blocks[0]);
      return { commands: [f.command] };
    });
    await runDesktopLiveTick({ ...f, request });
    expect(native.approve).toHaveBeenCalledExactlyOnceWith(
      "codex",
      f.value.id,
      71,
      "allow",
      f.value.blocks[0].approval!.occurrenceId,
    );
    expect(f.registry.readApprovalIntent(f.value, 71)).toMatchObject({
      callback: "void",
      phase: "unconfirmed",
      repeatBlocked: true,
      providerAck: "unproved",
    });
    request.mockImplementation(async () => ({ commands: [f.command] }));
    await runDesktopLiveTick({ ...f, request });
    expect(native.approve).toHaveBeenCalledTimes(1);
    expect([...f.unacked]).toEqual([f.command.id]);
  });

  it("refuses a same-ID replacement block after the heartbeat await without recapturing", async () => {
    const f = fixture();
    const original = f.value;
    await runDesktopLiveTick({
      ...f,
      request: async () => {
        await Promise.resolve();
        f.replace({
          ...original,
          blocks: [{ ...original.blocks[0], approval: { requestId: 71 } }],
        });
        return { commands: [f.command] };
      },
    });
    expect(f.handlers.captureApproval).toHaveBeenCalledOnce();
    expect(f.handlers.captureApproval.mock.calls[0][0]).toBe(original);
    expect(f.handlers.approve).not.toHaveBeenCalled();
    expect(native.approve).not.toHaveBeenCalled();
  });

  it("never supplies a post-await token for a request absent from the published cut", async () => {
    const f = fixture();
    const later = f.value;
    f.replace({ ...later, busy: true, blocks: [] });
    await runDesktopLiveTick({
      ...f,
      request: async () => {
        f.replace(later);
        return { commands: [f.command] };
      },
    });
    expect(f.handlers.captureApproval).not.toHaveBeenCalled();
    expect(f.handlers.approve).not.toHaveBeenCalled();
    expect(native.approve).not.toHaveBeenCalled();
  });

  it("keeps a failed original capture absent even if the source becomes available while waiting", async () => {
    const f = fixture();
    f.handlers.captureApproval.mockReturnValueOnce(undefined);
    await runDesktopLiveTick({
      ...f,
      request: async () => ({ commands: [f.command] }),
    });
    expect(f.handlers.captureApproval).toHaveBeenCalledOnce();
    expect(f.handlers.approve).not.toHaveBeenCalled();
    expect(native.approve).not.toHaveBeenCalled();
  });

  it("lets the central latest-source check refuse a changed Native adapter before effect", async () => {
    const f = fixture();
    await runDesktopLiveTick({
      ...f,
      request: async () => {
        native.adapter = { respondApproval: vi.fn() };
        return { commands: [f.command] };
      },
    });
    expect(f.handlers.approve).toHaveBeenCalledOnce();
    expect(native.approve).not.toHaveBeenCalled();
    expect(f.registry.readApprovalIntent(f.value, 71)).toMatchObject({
      phase: "rejected",
      callback: "not-started",
      repeatBlocked: false,
    });
  });

  it("revalidates in-place original body changes at the real consumer", async () => {
    const f = fixture();
    await runDesktopLiveTick({
      ...f,
      request: async () => {
        f.value.blocks[0].text = "a different request body";
        return { commands: [f.command] };
      },
    });
    expect(f.handlers.approve).toHaveBeenCalledOnce();
    expect(native.approve).not.toHaveBeenCalled();
  });

  it("uses the central latest getter after a reentrant publication replaces the request", () => {
    const f = fixture();
    f.registry.subscribe(() => {
      const current = f.value;
      f.replace({
        ...current,
        blocks: [{ ...current.blocks[0], approval: { requestId: 71 } }],
      });
    });
    expect(applyDesktopLiveCommand(f.command, f.sessions(), f.handlers)).toBe(false);
    expect(f.handlers.approve).toHaveBeenCalledOnce();
    expect(native.approve).not.toHaveBeenCalled();
  });

  it("refuses direct approval dispatch without an actual capture port", () => {
    const f = fixture();
    expect(
      applyDesktopLiveCommand(f.command, f.sessions(), {
        stop: f.handlers.stop,
        answer: f.handlers.answer,
        approve: f.handlers.approve,
      }),
    ).toBe(false);
    expect(f.handlers.approve).not.toHaveBeenCalled();
    expect(native.approve).not.toHaveBeenCalled();
  });

  it("keeps an actually closed approval in the Host queue and retries the original token once after release", async () => {
    const f = fixture();
    const gate = f.parent.begin("logical-root", { owner: {}, timeoutMs: 1000 });
    const request = vi.fn(async (_payload: DesktopLivePayload) => ({
      commands: [f.command],
    }));
    try {
      await runDesktopLiveTick({ ...f, request });
      expect(native.approve).not.toHaveBeenCalled();
      expect(f.handled.size).toBe(0);
      expect(f.unacked.size).toBe(0);
      const originalToken = f.handlers.captureApproval.mock.results[0].value;
      gate.release();
      await runDesktopLiveTick({ ...f, request });
      expect(request.mock.calls[1][0].acked).toBeUndefined();
      expect(f.handlers.approve.mock.lastCall?.[3]).toBe(originalToken);
      expect(native.approve).toHaveBeenCalledExactlyOnceWith(
        "codex",
        f.value.id,
        71,
        "allow",
        f.value.blocks[0].approval!.occurrenceId,
      );
      expect(f.unacked.has(f.command.id)).toBe(true);
      await runDesktopLiveTick({ ...f, request });
      expect(request.mock.calls[2][0].acked).toEqual([f.command.id]);
      expect(native.approve).toHaveBeenCalledTimes(1);
    } finally {
      gate.release();
    }
  });

  it("does not ACK real capacity refusal and retries only after actual prior-source resolution frees capacity", async () => {
    const f = fixture({ records: 1 });
    const prior = newSession("codex", "G:/original-capacity-owner");
    prior.blocks = [approvalBlock(72)];
    f.registry.submitApprovalIntent(
      prior,
      72,
      "deny",
      f.registry.captureApprovalRequest(prior, 72),
    );
    const request = async () => ({ commands: [f.command] });
    await runDesktopLiveTick({ ...f, request });
    expect(native.approve).toHaveBeenCalledExactlyOnceWith(
      "codex",
      prior.id,
      72,
      "deny",
      prior.blocks[0].approval!.occurrenceId,
    );
    expect(f.handled.size).toBe(0);
    expect(f.unacked.size).toBe(0);
    const originalToken = f.handlers.captureApproval.mock.results[0].value;
    const event = {
      type: "approval.resolved",
      requestId: 72,
      decision: "deny",
    } as const;
    f.registry.observeApprovalResolutions(prior, applyHarnessEvent(prior, event), [event]);
    await runDesktopLiveTick({ ...f, request });
    expect(f.handlers.approve.mock.lastCall?.[3]).toBe(originalToken);
    expect(native.approve).toHaveBeenCalledTimes(2);
    expect(native.approve).toHaveBeenLastCalledWith(
      "codex",
      f.value.id,
      71,
      "allow",
      f.value.blocks[0].approval!.occurrenceId,
    );
    expect(f.unacked.has(f.command.id)).toBe(true);
  });

  it("never retargets a held original choice to a later same-ID replacement", async () => {
    const f = fixture();
    const gate = f.parent.begin("logical-root", { owner: {}, timeoutMs: 1000 });
    try {
      await runDesktopLiveTick({
        ...f,
        request: async () => ({ commands: [f.command] }),
      });
      expect(f.unacked.size).toBe(0);
      gate.release();
      f.replace({
        ...f.value,
        blocks: [{ ...f.value.blocks[0], approval: { requestId: 71 } }],
      });
      await runDesktopLiveTick({
        ...f,
        request: async () => ({ commands: [f.command] }),
      });
      expect(f.handlers.approve).toHaveBeenCalledTimes(1);
      expect(native.approve).not.toHaveBeenCalled();
      expect(f.unacked.has(f.command.id)).toBe(true); // Explicit original identity is stale.
    } finally {
      gate.release();
    }
  });

  it("pins a missing original token across retries instead of borrowing a newly available capture", async () => {
    const f = fixture();
    f.handlers.captureApproval.mockReturnValueOnce(undefined);
    const request = async () => ({ commands: [f.command] });
    await runDesktopLiveTick({ ...f, request });
    await runDesktopLiveTick({ ...f, request });
    expect(f.handlers.captureApproval.mock.results[1].value).toBeDefined();
    expect(f.handlers.approve).not.toHaveBeenCalled();
    expect(f.handled.size).toBe(0);
    expect(f.unacked.size).toBe(0);
    expect(native.approve).not.toHaveBeenCalled();
  });

  it("holds a fresh choice when an earlier different decision is still consumption-unproved", async () => {
    const f = fixture();
    f.registry.submitApprovalIntent(
      f.value,
      71,
      "deny",
      f.registry.captureApprovalRequest(f.value, 71),
    );
    const request = async () => ({ commands: [f.command] });
    await runDesktopLiveTick({ ...f, request });
    await runDesktopLiveTick({ ...f, request });
    expect(native.approve).toHaveBeenCalledExactlyOnceWith(
      "codex",
      f.value.id,
      71,
      "deny",
      f.value.blocks[0].approval!.occurrenceId,
    );
    expect(f.unacked.size).toBe(0);
    expect(f.handled.size).toBe(0);
    expect(f.registry.readApprovalIntent(f.value, 71)).toMatchObject({
      decision: "deny",
      callback: "void",
      providerAck: "unproved",
    });
  });

  it("ACKs an actual pending callback attempt once while its real Promise and raw original remain live", async () => {
    const f = fixture();
    let resolve!: () => void;
    const actual = new Promise<void>((done) => {
      resolve = done;
    });
    const approve = vi.fn(() => actual);
    f.value.hostBinding = {
      kind: "local-host",
      machineId: "machine",
      environmentId: "environment",
      projectId: "project",
      sessionId: "host-original",
      authorityGeneration: 1,
      created: true,
    };
    const detach = registerRemoteSessionActions(f.value.id, {
      approve,
      approvalOccurrenceSupported: true,
    } as never);
    const request = async () => ({ commands: [f.command] });
    let gate: ReturnType<ParentInputRegistry["begin"]> | undefined;
    try {
      await runDesktopLiveTick({ ...f, request });
      expect(approve).toHaveBeenCalledExactlyOnceWith(
        71,
        "allow",
        f.value.blocks[0].approval!.occurrenceId,
      );
      expect(f.unacked.has(f.command.id)).toBe(true);
      expect(f.registry.readApprovalIntent(f.value, 71)).toMatchObject({
        phase: "pending",
        callback: "pending",
        providerAck: "unproved",
      });
      gate = f.parent.begin("logical-root", { owner: {}, timeoutMs: 1000 });
      let drained = false;
      const capture = gate.capture().then((lease) => {
        drained = true;
        return lease;
      });
      await Promise.resolve();
      expect(drained).toBe(false);
      await runDesktopLiveTick({ ...f, request });
      expect(approve).toHaveBeenCalledTimes(1);
      resolve();
      await f.handlers.approve.mock.results[0].value;
      const lease = await capture;
      try {
        expect(lease.snapshots[0].snapshot).toMatchObject({
          qualified: false,
          rosterComplete: false,
          records: [
            expect.objectContaining({
              callback: "fulfilled",
              phase: "unconfirmed",
              providerAck: "unproved",
            }),
          ],
        });
      } finally {
        lease.release();
      }
    } finally {
      resolve();
      gate?.release();
      detach();
    }
  });

  it("holds a reentrant pre-effect refusal, then consumes only the original's explicit stale witness", async () => {
    const f = fixture();
    const unsubscribe = f.registry.subscribe(() => {
      f.replace({
        ...f.value,
        blocks: [{ ...f.value.blocks[0], approval: { requestId: 71 } }],
      });
    });
    try {
      await runDesktopLiveTick({
        ...f,
        request: async () => ({ commands: [f.command] }),
      });
      expect(native.approve).not.toHaveBeenCalled();
      expect(f.unacked.size).toBe(0);
      expect(f.handled.size).toBe(0);
      unsubscribe();
      await runDesktopLiveTick({
        ...f,
        request: async () => ({ commands: [f.command] }),
      });
      expect(native.approve).not.toHaveBeenCalled();
      expect(f.handlers.approve).toHaveBeenCalledTimes(1);
      expect(f.unacked.has(f.command.id)).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  it("bounds held originals without eviction or later retargeting of an unpinned overflow command", async () => {
    const f = fixture();
    f.replace({
      ...f.value,
      blocks: Array.from({ length: 65 }, (_, index) => ({
        ...approvalBlock(index + 1),
        text: `Original request ${index + 1}`,
      })),
    });
    const commands: DesktopLiveCommand[] = f.value.blocks.map((block) => ({
      id: `command-${block.approval!.requestId}`,
      sessionId: f.value.id,
      type: "approve",
      requestId: block.approval!.requestId,
      decision: "allow",
      approvalOccurrenceId: block.approval!.occurrenceId,
    }));
    const gate = f.parent.begin("logical-root", { owner: {}, timeoutMs: 1000 });
    const request = async () => ({ commands });
    try {
      await runDesktopLiveTick({ ...f, request });
      expect(f.handlers.approve).toHaveBeenCalledTimes(64);
      expect(f.handled.size).toBe(0);
      expect(f.unacked.size).toBe(0);
      expect(native.approve).not.toHaveBeenCalled();
      gate.release();
      f.replace({ ...f.value, blocks: [f.value.blocks[64]] });
      await runDesktopLiveTick({ ...f, request });
      expect(f.handled.size).toBe(64); // Only known originals are now explicitly stale.
      expect(f.unacked.has("command-65")).toBe(false);
      expect(f.handlers.approve).toHaveBeenCalledTimes(64);
      expect(native.approve).not.toHaveBeenCalled();
      await runDesktopLiveTick({ ...f, request });
      expect(f.unacked.has("command-65")).toBe(false);
      expect(native.approve).not.toHaveBeenCalled();
    } finally {
      gate.release();
    }
  });

  it.each([undefined, "invalid"])(
    "holds missing/invalid wire occurrence %s without ACK or a fresh numeric fallback",
    async (approvalOccurrenceId) => {
      const f = fixture();
      const command = { ...f.command, approvalOccurrenceId };
      const request = async () => ({ commands: [command] });
      await runDesktopLiveTick({ ...f, request });
      await runDesktopLiveTick({ ...f, request });
      expect(f.handlers.approve).not.toHaveBeenCalled();
      expect(native.approve).not.toHaveBeenCalled();
      expect(f.handled.size).toBe(0);
      expect(f.unacked.size).toBe(0);
    },
  );

  it("holds an otherwise exact command while the actual Host capability is absent", async () => {
    const f = fixture();
    const request = async () => ({ commands: [f.command] });
    await runDesktopLiveTick({ ...f, request, approvalOccurrenceSupported: false });
    expect(f.handlers.approve).not.toHaveBeenCalled();
    expect(f.unacked.size).toBe(0);
    await runDesktopLiveTick({ ...f, request });
    expect(native.approve).toHaveBeenCalledExactlyOnceWith(
      "codex",
      f.value.id,
      71,
      "allow",
      f.command.approvalOccurrenceId,
    );
  });

  it("refuses delayed A when same numeric ID B already replaced it before this heartbeat", async () => {
    const f = fixture();
    const oldCommand = f.command;
    f.replace({
      ...f.value,
      blocks: [
        {
          ...f.value.blocks[0],
          approval: { requestId: 71, occurrenceId: createApprovalOccurrenceId() },
        },
      ],
    });
    await runDesktopLiveTick({ ...f, request: async () => ({ commands: [oldCommand] }) });
    expect(f.handlers.approve).not.toHaveBeenCalled();
    expect(native.approve).not.toHaveBeenCalled();
    expect(f.unacked.has(oldCommand.id)).toBe(true); // Nonce A is explicitly stale against current B.
  });

  it("refuses an in-place nonce replacement even when Block and approval objects survive", async () => {
    const f = fixture();
    await runDesktopLiveTick({
      ...f,
      request: async () => {
        f.value.blocks[0].approval!.occurrenceId = createApprovalOccurrenceId();
        return { commands: [f.command] };
      },
    });
    expect(f.handlers.approve).not.toHaveBeenCalled();
    expect(native.approve).not.toHaveBeenCalled();
    expect(f.unacked.has(f.command.id)).toBe(true);
  });

  it("never upgrades a held unidentified original command ID by attaching a later valid nonce", async () => {
    const f = fixture();
    const unidentified = { ...f.command, approvalOccurrenceId: undefined };
    await runDesktopLiveTick({ ...f, request: async () => ({ commands: [unidentified] }) });
    expect(f.unacked.size).toBe(0);
    await runDesktopLiveTick({ ...f, request: async () => ({ commands: [f.command] }) });
    expect(f.handlers.approve).not.toHaveBeenCalled();
    expect(native.approve).not.toHaveBeenCalled();
    expect(f.unacked.has(f.command.id)).toBe(true); // Same command ID changed its immutable envelope.
  });
});

describe("runDesktopLiveTick", () => {
  it("acknowledges writer transfer only after retirement finishes, including a closed tab", async () => {
    let finish!: () => void;
    let writers = ["warm"];
    const retireWriter = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            writers = [];
            resolve();
          };
        }),
    );
    const job = {
      id: "transfer",
      sessionId: "warm",
      type: "retire-writer" as const,
    };
    const request = vi.fn(async (_payload: DesktopLivePayload) => ({
      commands: [job],
    }));
    const unacked = new Set<string>();
    const deps = {
      request,
      sessions: () => [],
      writers: () => writers,
      handlers: {
        stop: vi.fn(),
        approve: vi.fn(),
        answer: vi.fn(),
        retireWriter,
      },
      unacked,
      handled: new Set<string>(),
    };
    const tick = runDesktopLiveTick(deps);
    await vi.waitFor(() => expect(retireWriter).toHaveBeenCalledWith("warm"));
    expect(unacked.size).toBe(0);
    finish();
    await tick;
    expect(unacked.has(job.id)).toBe(true);
    await runDesktopLiveTick(deps);
    expect(request.mock.lastCall?.[0]).toMatchObject({
      acked: [job.id],
      writers: { version: 1, sessionIds: [] },
    });
    expect(retireWriter).toHaveBeenCalledOnce();
  });

  it("never ACKs failed writer retirement", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const unacked = new Set<string>();
      await runDesktopLiveTick({
        request: async () => ({
          commands: [{ id: "failed", sessionId: "warm", type: "retire-writer" }],
        }),
        sessions: () => [],
        writers: () => ["warm"],
        handlers: {
          stop: vi.fn(),
          approve: vi.fn(),
          answer: vi.fn(),
          retireWriter: async () => {
            throw new Error("stop failed");
          },
        },
        unacked,
        handled: new Set<string>(),
      });
      expect(unacked.size).toBe(0);
    } finally {
      error.mockRestore();
    }
  });

  it("omits acknowledged directory bytes, resends after reset and falls back for old hosts", async () => {
    let directory = {
      version: 1 as const,
      groups: [],
      excludedPaths: [] as string[],
      excludedGroupIds: [],
      projects: Array.from({ length: 200 }, (_, index) => ({
        cwd: `/p/${index}`,
        name: `Project ${index}`,
        appearance: { logo: `data:image/png;base64,${"a".repeat(1024)}` },
      })),
    };
    let mode: "new" | "reset" | "old" = "new";
    const request = vi.fn(async (payload: DesktopLivePayload) => ({
      commands: [],
      ...(mode === "new" || (mode === "reset" && payload.projectDirectory)
        ? { projectDirectoryRevision: payload.projectDirectoryRevision }
        : {}),
    }));
    const deps = {
      beat: {},
      request,
      sessions: () => [session({ id: "busy", busy: true })],
      projectDirectory: () => directory,
      handlers: { stop: vi.fn(), approve: vi.fn(), answer: vi.fn() },
      unacked: new Set<string>(),
      handled: new Set<string>(),
      clientId: "window-a",
    };
    await runDesktopLiveTick(deps);
    await runDesktopLiveTick(deps);
    expect(request.mock.calls[0][0].projectDirectory).toBe(directory);
    expect(request.mock.calls[1][0].projectDirectory).toBeUndefined();
    expect(JSON.stringify(request.mock.calls[1][0]).length).toBeLessThan(
      JSON.stringify(request.mock.calls[0][0]).length / 10,
    );
    directory = { ...directory, excludedPaths: ["/private"] };
    await runDesktopLiveTick(deps);
    expect(request.mock.lastCall![0].projectDirectory?.excludedPaths).toEqual(["/private"]);
    mode = "reset";
    await runDesktopLiveTick(deps);
    expect(request.mock.lastCall![0].projectDirectory).toBeUndefined();
    await runDesktopLiveTick(deps);
    expect(request.mock.lastCall![0].projectDirectory).toBe(directory);
    mode = "old";
    await runDesktopLiveTick(deps);
    await runDesktopLiveTick(deps);
    await runDesktopLiveTick(deps);
    expect(
      request.mock.calls.slice(-2).every(([payload]) => payload.projectDirectory === directory),
    ).toBe(true);
  });

  it("publishes session folder and manual-order changes during an otherwise idle heartbeat", async () => {
    let folderName = "Initial";
    const deps = {
      now: () => 100,
      beat: {},
      request: vi.fn().mockResolvedValue({ commands: [] }),
      sessions: () => [],
      projectDirectory: () => ({
        version: 1 as const,
        groups: [],
        excludedPaths: [],
        excludedGroupIds: [],
        projects: [
          {
            cwd: "/project",
            name: "Project",
            sessionLayout: {
              folders: [
                {
                  id: "f",
                  name: folderName,
                  sessionIds: ["s"],
                  collapsed: false,
                },
              ],
              order: { loose: [folderName] },
            },
          },
        ],
      }),
      handlers: { stop: vi.fn(), approve: vi.fn(), answer: vi.fn() },
      unacked: new Set<string>(),
      handled: new Set<string>(),
    };
    await runDesktopLiveTick(deps);
    await runDesktopLiveTick(deps);
    expect(deps.request).toHaveBeenCalledTimes(1);
    folderName = "Renamed";
    await runDesktopLiveTick(deps);
    expect(deps.request).toHaveBeenCalledTimes(2);
    expect(
      deps.request.mock.lastCall?.[0].projectDirectory.projects[0].sessionLayout,
    ).toMatchObject({
      folders: [{ name: "Renamed" }],
      order: { loose: ["Renamed"] },
    });
  });
  it("publishes a changed directory privacy snapshot without waiting for the idle heartbeat", async () => {
    let now = 0;
    let excludedPaths: string[] = [];
    const deps = {
      now: () => now,
      beat: {},
      request: vi.fn().mockResolvedValue({ commands: [] }),
      sessions: () => [],
      projectDirectory: () => ({
        version: 1 as const,
        projects: [],
        groups: [],
        excludedPaths,
        excludedGroupIds: [],
      }),
      handlers: { stop: vi.fn(), approve: vi.fn(), answer: vi.fn() },
      unacked: new Set<string>(),
      handled: new Set<string>(),
    };
    await runDesktopLiveTick(deps);
    now = 100;
    await runDesktopLiveTick(deps);
    expect(deps.request).toHaveBeenCalledTimes(1);
    excludedPaths = ["/private"];
    await runDesktopLiveTick(deps);
    expect(deps.request).toHaveBeenCalledTimes(2);
    expect(deps.request.mock.lastCall?.[0].projectDirectory.excludedPaths).toEqual(["/private"]);
  });
  it("hands the shared queues another computer changed to the desktop, starting after the first answer", async () => {
    const onQueuesChanged = vi.fn();
    const beat = {} as { queueSeq?: number };
    const request = vi
      .fn()
      .mockResolvedValueOnce({ queues: { seq: 4, ids: ["old"], reset: true } })
      .mockResolvedValueOnce({ queues: { seq: 6, ids: ["chat"] } })
      .mockResolvedValueOnce({ queues: { seq: 1, ids: [], reset: true } });
    const deps = {
      beat,
      request,
      onQueuesChanged,
      sessions: () => [session({ id: "s", busy: true })],
      handlers: { stop: vi.fn(), approve: vi.fn(), answer: vi.fn() },
      unacked: new Set<string>(),
      handled: new Set<string>(),
    };
    await runDesktopLiveTick(deps);
    // The first answer only sets the cursor: nothing was missed yet.
    expect(onQueuesChanged).not.toHaveBeenCalled();
    expect(request.mock.calls[0][0].queueSeq).toBeUndefined();
    await runDesktopLiveTick(deps);
    expect(request.mock.calls[1][0].queueSeq).toBe(4);
    expect(onQueuesChanged).toHaveBeenLastCalledWith(["chat"]);
    // A host that restarted cannot say what changed: any queue may have.
    await runDesktopLiveTick(deps);
    expect(request.mock.calls[2][0].queueSeq).toBe(6);
    expect(onQueuesChanged).toHaveBeenLastCalledWith(undefined);
    expect(beat.queueSeq).toBe(1);
  });
  it("wakes nothing for an answer that names no changed queue", async () => {
    const onQueuesChanged = vi.fn();
    const beat = { queueSeq: 3 } as { queueSeq?: number };
    await runDesktopLiveTick({
      beat,
      request: vi.fn().mockResolvedValue({ queues: { seq: 3, ids: [] } }),
      onQueuesChanged,
      sessions: () => [session({ id: "s", busy: true })],
      handlers: { stop: vi.fn(), approve: vi.fn(), answer: vi.fn() },
      unacked: new Set<string>(),
      handled: new Set<string>(),
    });
    expect(onQueuesChanged).not.toHaveBeenCalled();
  });
  it("hands the adopted sessions that moved on the host to the desktop with every answer", async () => {
    const onAdopted = vi.fn();
    const beat = {} as { adoptedSeq?: number };
    const request = vi
      .fn()
      .mockResolvedValueOnce({ adopted: { seq: 0, ids: [], reset: true } })
      .mockResolvedValueOnce({ adopted: { seq: 0, ids: [] } })
      .mockResolvedValueOnce({ adopted: { seq: 2, ids: ["a", "b"] } })
      .mockResolvedValueOnce({ adopted: { seq: 1, ids: [], reset: true } })
      .mockResolvedValueOnce({}); // a host that does not report them
    const deps = {
      beat,
      request,
      onAdopted,
      sessions: () => [session({ id: "s", busy: true })],
      handlers: { stop: vi.fn(), approve: vi.fn(), answer: vi.fn() },
      unacked: new Set<string>(),
      handled: new Set<string>(),
    };
    await runDesktopLiveTick(deps);
    // The first answer is a reset: the desktop reads the list once to catch up.
    expect(onAdopted).toHaveBeenLastCalledWith({ ids: [], reset: true });
    expect(request.mock.calls[0][0].adoptedSeq).toBeUndefined();
    await runDesktopLiveTick(deps);
    expect(request.mock.calls[1][0].adoptedSeq).toBe(0);
    expect(onAdopted).toHaveBeenLastCalledWith({ ids: [], reset: false });
    await runDesktopLiveTick(deps);
    expect(onAdopted).toHaveBeenLastCalledWith({
      ids: ["a", "b"],
      reset: false,
    });
    // A host that restarted cannot say what moved.
    await runDesktopLiveTick(deps);
    expect(onAdopted).toHaveBeenLastCalledWith({ ids: [], reset: true });
    expect(beat.adoptedSeq).toBe(1);
    await runDesktopLiveTick(deps);
    expect(onAdopted).toHaveBeenCalledTimes(4);
  });
  it("reports the drain leases this desktop holds on its beat and hands the host's answer back", async () => {
    const answered = vi.fn();
    const held = vi.fn(() => [{ sessionId: "chat", epoch: 3 }]);
    const request = vi.fn().mockResolvedValue({
      queueLeases: {
        chat: { holder: "desktop:w", epoch: 3, expiresAt: 99 },
        gone: null,
      },
    });
    await runDesktopLiveTick({
      request,
      clientId: "w",
      queueLeases: { held, answered },
      sessions: () => [session({ id: "s", busy: true })],
      handlers: { stop: vi.fn(), approve: vi.fn(), answer: vi.fn() },
      unacked: new Set<string>(),
      handled: new Set<string>(),
    });
    expect(request.mock.calls[0][0].queueLeases).toEqual([{ sessionId: "chat", epoch: 3 }]);
    expect(answered).toHaveBeenCalledWith({
      chat: { holder: "desktop:w", epoch: 3, expiresAt: 99 },
      gone: null,
    });
    // Holding nothing adds nothing to the beat.
    held.mockReturnValue([]);
    await runDesktopLiveTick({
      request,
      queueLeases: { held, answered },
      sessions: () => [session({ id: "s", busy: true })],
      handlers: { stop: vi.fn(), approve: vi.fn(), answer: vi.fn() },
      unacked: new Set<string>(),
      handled: new Set<string>(),
    });
    expect(request.mock.calls[1][0].queueLeases).toBeUndefined();
  });
  it("keeps its run leases alive on the beat and stops the conversations whose lease the host took back", async () => {
    const held = vi.fn(() => [{ sessionId: "chat", epoch: 4 }]);
    const answered = vi.fn(() => ["chat"]);
    const stop = vi.fn();
    const request = vi.fn().mockResolvedValue({ runLeases: { chat: null } });
    await runDesktopLiveTick({
      request,
      clientId: "w",
      runLeases: { held, answered },
      sessions: () => [session({ id: "chat", busy: true })],
      handlers: { stop, approve: vi.fn(), answer: vi.fn() },
      unacked: new Set<string>(),
      handled: new Set<string>(),
    });
    expect(request.mock.calls[0][0].runLeases).toEqual([{ sessionId: "chat", epoch: 4 }]);
    expect(answered).toHaveBeenCalledWith({ chat: null });
    expect(stop).toHaveBeenCalledExactlyOnceWith("chat");
    // A lease that was kept stops nothing, and holding nothing adds nothing to the beat.
    stop.mockClear();
    answered.mockReturnValue([]);
    request.mockResolvedValue({
      runLeases: { chat: { holder: "desktop:w", epoch: 5, expiresAt: 9 } },
    });
    await runDesktopLiveTick({
      request,
      runLeases: { held, answered },
      sessions: () => [session({ id: "chat", busy: true })],
      handlers: { stop, approve: vi.fn(), answer: vi.fn() },
      unacked: new Set<string>(),
      handled: new Set<string>(),
    });
    expect(stop).not.toHaveBeenCalled();
    held.mockReturnValue([]);
    await runDesktopLiveTick({
      request,
      runLeases: { held, answered },
      sessions: () => [session({ id: "chat", busy: true })],
      handlers: { stop, approve: vi.fn(), answer: vi.fn() },
      unacked: new Set<string>(),
      handled: new Set<string>(),
    });
    expect(request.mock.calls[2][0].runLeases).toBeUndefined();
  });
  it("retries a command whose local handler throws without acknowledging it", async () => {
    const command: DesktopLiveCommand = {
      id: "retry",
      sessionId: "s",
      type: "cancel",
    };
    const stop = vi.fn().mockImplementationOnce(() => {
      throw new Error("not ready");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = {
      request: vi.fn().mockResolvedValue({ commands: [command] }),
      sessions: () => [session({ id: "s", busy: true })],
      handlers: { stop, approve: vi.fn(), answer: vi.fn() },
      unacked: new Set<string>(),
      handled: new Set<string>(),
      clientId: "window",
    };
    try {
      await runDesktopLiveTick(deps);
      expect(deps.unacked.size).toBe(0);
      expect(deps.handled.size).toBe(0);
      await runDesktopLiveTick(deps);
      expect([...deps.unacked]).toEqual(["retry"]);
      expect(deps.request.mock.calls[0][0].clientId).toBe("window");
    } finally {
      log.mockRestore();
    }
  });
  it("executes once, acks on the next call, and dedupes re-sent commands", async () => {
    const stop = vi.fn();
    const cmd: DesktopLiveCommand = {
      id: "c1",
      sessionId: "s",
      type: "cancel",
    };
    const stale: DesktopLiveCommand = {
      id: "c2",
      sessionId: "gone",
      type: "cancel",
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce({ commands: [cmd, stale] })
      .mockResolvedValueOnce({ commands: [cmd] })
      .mockResolvedValueOnce({ commands: [] });
    const deps = {
      request,
      sessions: () => [session({ id: "s", busy: true })],
      handlers: { stop, approve: vi.fn(), answer: vi.fn() },
      unacked: new Set<string>(),
      handled: new Set<string>(),
    };
    await runDesktopLiveTick(deps);
    expect(request.mock.calls[0][0].acked).toBeUndefined();
    await runDesktopLiveTick(deps);
    expect(request.mock.calls[1][0].acked).toEqual(["c1"]);
    await runDesktopLiveTick(deps);
    expect(request.mock.calls[2][0].acked).toEqual(["c1"]);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("keeps acks when the request fails", async () => {
    const unacked = new Set(["x"]);
    const request = vi.fn().mockRejectedValue(new Error("down"));
    await expect(
      runDesktopLiveTick({
        request,
        sessions: () => [],
        handlers: { stop: vi.fn(), approve: vi.fn(), answer: vi.fn() },
        unacked,
        handled: new Set(),
      }),
    ).rejects.toThrow();
    expect([...unacked]).toEqual(["x"]);
  });
});

describe("desktop deletion jobs", () => {
  it("deletes unopened history once and confirms only after the handler finishes", async () => {
    let finish!: () => void;
    const remove = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const job = { id: "delete-1", sessionId: "history", cwd: "/project", requestedBy: "Laptop" };
    const request = vi.fn().mockResolvedValue({ deletions: { jobs: [job], acked: [] } });
    const deletions = {
      results: new Map<string, { id: string; error?: string }>(),
      running: new Set<string>(),
    };
    const deps = {
      request,
      sessions: () => [],
      deletions,
      handlers: {
        stop: vi.fn(),
        approve: vi.fn(),
        answer: vi.fn(),
        delete: remove,
      },
      unacked: new Set<string>(),
      handled: new Set<string>(),
    };
    await runDesktopLiveTick(deps);
    expect(remove).toHaveBeenCalledWith("history", "/project", "Laptop");
    expect(deletions.results.size).toBe(0);
    await runDesktopLiveTick(deps);
    expect(remove).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(deletions.results.get(job.id)).toEqual({ id: job.id }));
    request.mockRejectedValueOnce(new Error("offline"));
    await expect(runDesktopLiveTick(deps)).rejects.toThrow("offline");
    expect(deletions.results.size).toBe(1);
    request.mockResolvedValue({ deletions: { jobs: [], acked: [job.id] } });
    await runDesktopLiveTick(deps);
    expect(request.mock.calls.at(-1)?.[0].deletions.replies).toEqual([{ id: job.id }]);
    expect(deletions.results.size).toBe(0);
  });

  it("reports desktop refusal without claiming a successful deletion", async () => {
    const deletions = {
      results: new Map<string, { id: string; error?: string }>(),
      running: new Set<string>(),
    };
    await runDesktopLiveTick({
      request: async () => ({
        deletions: {
          jobs: [{ id: "d", sessionId: "s", cwd: "/project" }],
          acked: [],
        },
      }),
      sessions: () => [],
      deletions,
      handlers: {
        stop: vi.fn(),
        approve: vi.fn(),
        answer: vi.fn(),
        delete: async () => {
          throw new Error("Stop this session before deleting it");
        },
      },
      unacked: new Set(),
      handled: new Set(),
    });
    await vi.waitFor(() => expect(deletions.results.get("d")?.error).toMatch(/Stop this session/));
  });
});

describe("supportsDesktopLive", () => {
  it("checks the capability", () => {
    expect(supportsDesktopLive(["sessions.desktopLive"])).toBe(true);
    expect(supportsDesktopLive(["sessions.desktop"])).toBe(false);
    expect(supportsDesktopLive(undefined)).toBe(false);
  });
});

describe("desktop live memoization and idle cadence", () => {
  it("rescans only sessions whose object changed", () => {
    let reads = 0;
    const counted = (id: string) => {
      const s = session({ id });
      Object.defineProperty(s, "blocks", {
        get() {
          reads++;
          return [];
        },
      });
      return s;
    };
    const a = counted("a");
    const b = counted("b");
    buildDesktopLiveSessions([a, b]);
    expect(reads).toBe(2);
    const c = counted("c");
    buildDesktopLiveSessions([a, b, c]);
    expect(reads).toBe(3);
  });

  it("sends an empty heartbeat once, then waits for the idle interval", async () => {
    const request = vi.fn().mockResolvedValue({});
    let now = 1_000;
    const deps = {
      request,
      sessions: () => [session({ id: "idle" })],
      handlers: { stop: vi.fn(), approve: vi.fn(), answer: vi.fn() },
      unacked: new Set<string>(),
      handled: new Set<string>(),
      beat: {},
      now: () => now,
    };
    await runDesktopLiveTick(deps);
    now += 1_500;
    await runDesktopLiveTick(deps);
    expect(request).toHaveBeenCalledTimes(1);
    now += 3_600; // past DESKTOP_LIVE_IDLE_MS since the first beat
    await runDesktopLiveTick(deps);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("goes back to every tick as soon as a session is busy or an ack is pending", async () => {
    const request = vi.fn().mockResolvedValue({});
    let busy = false;
    const unacked = new Set<string>();
    const deps = {
      request,
      sessions: () => [session({ id: "s", busy })],
      handlers: { stop: vi.fn(), approve: vi.fn(), answer: vi.fn() },
      unacked,
      handled: new Set<string>(),
      beat: {},
      now: () => 1_000,
    };
    await runDesktopLiveTick(deps);
    await runDesktopLiveTick(deps);
    expect(request).toHaveBeenCalledTimes(1);
    busy = true;
    await runDesktopLiveTick(deps);
    await runDesktopLiveTick(deps);
    expect(request).toHaveBeenCalledTimes(3);
    busy = false;
    unacked.add("c1");
    await runDesktopLiveTick(deps);
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls[3][0].acked).toEqual(["c1"]);
  });
});
