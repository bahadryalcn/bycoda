// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ParentInputRegistry, type ParentInputCapture } from "../data/parentInputClosure";
import { registerRemoteSessionActions } from "../../connections/model/remoteSessionActions";
import { saveHostSessionBinding } from "../../connections/model/sessionExecutionBinding";
import { createApprovalIntentRegistry, type ApprovalIntentView } from "./approvalIntents";
import { newSession, type Block, type Session } from "./session";
import { applyHarnessEvent } from "../../../integrations/harness/core/apply";
import { copyNativeCaptureData } from "../../../shared/lib/native-capture-json";
import { createApprovalOccurrenceId } from "../../../shared/model/approvalOccurrence";
import type { HostSession } from "../../connections/model/protocol";

const native = vi.hoisted(() => ({
  adapter: undefined as undefined | { respondApproval: (...args: unknown[]) => unknown },
  wrapper: vi.fn(),
}));
vi.mock("../../../integrations/harness", () => ({
  getHarness: () => native.adapter,
  // Match the PRODUCTION registry: returned adapter promises are discarded.
  respondHarnessApproval: (...args: unknown[]) => {
    native.wrapper(...args);
    native.adapter?.respondApproval(...args);
  },
}));
const cleanup: (() => void)[] = [];
beforeEach(() => {
  localStorage.clear();
  native.wrapper.mockClear();
  native.adapter = { respondApproval: vi.fn() };
});
afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
});
function fixture(limits?: { records?: number; bytes?: number }) {
  const parent = new ParentInputRegistry();
  const registry = createApprovalIntentRegistry({
    register: (adapter) => parent.register(adapter),
    limits,
  });
  return { parent, registry };
}
function session(id = 71, text = "  Original command\r\n😀  "): Session {
  const value = newSession("codex", "G:/original-project");
  value.providerSessionId = "original-provider-session";
  value.providerAccountId = "original-account";
  value.blocks = [
    {
      id: crypto.randomUUID(),
      role: "approval",
      text,
      approval: { requestId: id, occurrenceId: createApprovalOccurrenceId() },
      tool: { title: "Exact tool", preview: "original preview" },
    },
  ];
  return value;
}
function remote(value: Session, approve: (...args: unknown[]) => unknown) {
  value.hostBinding = {
    kind: "local-host",
    machineId: "machine",
    environmentId: "environment",
    projectId: "project",
    sessionId: "host-original",
    authorityGeneration: 4,
    created: true,
  };
  const actions = { approve, approvalOccurrenceSupported: true };
  const stop = registerRemoteSessionActions(value.id, actions as never);
  cleanup.push(stop);
  return { actions, stop };
}
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function hostSource(
  value: Session,
  approve: (...args: unknown[]) => unknown = vi.fn(),
  sourceSession = value,
) {
  remote(value, approve);
  sourceSession.hostBinding = value.hostBinding;
  const initial: HostSession = {
    session: { ...sourceSession, id: "host-original" },
    projectId: "project",
    runId: "original-host-run",
    authorityGeneration: 4,
    revision: 10,
    status: "running",
    updatedAt: 1,
  };
  let current: { session: Session; snapshot: HostSession } | undefined = {
    session: sourceSession,
    snapshot: initial,
  };
  const actions = { approve, approvalOccurrenceSupported: true, approvalSource: () => current };
  const detach = registerRemoteSessionActions(value.id, actions as never);
  cleanup.push(detach);
  return {
    actions,
    detach,
    initial,
    approve,
    set: (next: HostSession | undefined) => {
      current = next
        ? { session: { ...sourceSession, blocks: next.session.blocks }, snapshot: next }
        : undefined;
      return current?.session;
    },
  };
}
type Row = ApprovalIntentView & {
  original: {
    session: { id: string; providerSessionId?: string; providerAccountId?: string; cwd: string };
    request: Block;
    route: { kind: string };
  };
};
function rows(capture: ParentInputCapture): Row[] {
  const actor = capture.snapshots.find((row) => row.kind === "approval-decision");
  expect(actor?.sessionId).toBeUndefined();
  expect(actor?.snapshot).toMatchObject({
    qualified: false,
    rosterComplete: false,
    providerAck: "unproved",
    scope: "physical-profile-shared",
  });
  return (actor!.snapshot as { records: Row[] }).records;
}
async function capturedRows(parent: ParentInputRegistry) {
  const capture = await parent.capture("logical-root");
  try {
    expect(capture.current()).toBe(true);
    return rows(capture);
  } finally {
    capture.release();
  }
}

describe("source-issued approval occurrence identity", () => {
  // Keep these current-module checks before the final intentional HMR test.
  // A stale factory would otherwise make every negative dispatch assertion vacuous.
  it.each([undefined, "not-a-uuid"])(
    "refuses a remote request with invalid occurrence %s before callback",
    (occurrenceId) => {
      const { registry } = fixture();
      const value = session();
      value.blocks[0].approval!.occurrenceId = occurrenceId;
      const approve = vi.fn();
      remote(value, approve);
      const token = registry.captureApprovalRequest(value, 71);
      expect(token).toBeDefined();
      expect(registry.submitApprovalIntent(value, 71, "allow", token)).toBe(false);
      expect(registry.approvalRequestDispatchStarted(token)).toBe(false);
      expect(approve).not.toHaveBeenCalled();
      expect(registry.readApprovalRefusal(token)).toContain("request");
    },
  );

  it("refuses missing Host capability without upgrading the original token after a capability change", () => {
    const { registry } = fixture();
    const value = session();
    const approve = vi.fn();
    const route = remote(value, approve);
    route.actions.approvalOccurrenceSupported = false;
    const original = registry.captureApprovalRequest(value, 71);
    expect(original).toBeDefined();
    expect(registry.submitApprovalIntent(value, 71, "allow", original)).toBe(false);
    expect(registry.readApprovalRefusal(original)).toContain("Update the Host");
    route.actions.approvalOccurrenceSupported = true;
    expect(registry.submitApprovalIntent(value, 71, "allow", original)).toBe(false);
    expect(approve).not.toHaveBeenCalled();
    const current = registry.captureApprovalRequest(value, 71);
    expect(current).toBeDefined();
    registry.submitApprovalIntent(value, 71, "allow", current);
    expect(approve).toHaveBeenCalledExactlyOnceWith(
      71,
      "allow",
      value.blocks[0].approval!.occurrenceId,
    );
  });

  it("never substitutes a mutated current nonce for the originally captured request", () => {
    const { registry } = fixture();
    const value = session();
    const approve = vi.fn();
    remote(value, approve);
    const token = registry.captureApprovalRequest(value, 71);
    expect(token).toBeDefined();
    value.blocks[0].approval!.occurrenceId = createApprovalOccurrenceId();
    expect(registry.submitApprovalIntent(value, 71, "allow", token)).toBe(false);
    expect(registry.approvalRequestDispatchStarted(token)).toBe(false);
    expect(approve).not.toHaveBeenCalled();
  });

  it("keeps the exact unknown request when a same-ID remote resolution changes only its nonce", async () => {
    const { parent, registry } = fixture();
    const value = session();
    const host = hostSource(value);
    const original = value.blocks[0].approval!.occurrenceId;
    registry.submitApprovalIntent(value, 71, "allow", registry.captureApprovalRequest(value, 71));
    expect(host.approve).toHaveBeenCalledExactlyOnceWith(71, "allow", original);
    const changed = {
      ...host.initial,
      revision: 11,
      session: {
        ...host.initial.session,
        blocks: host.initial.session.blocks.map((block) => ({
          ...block,
          approval: {
            ...block.approval!,
            occurrenceId: createApprovalOccurrenceId(),
            decided: "allow" as const,
          },
        })),
      },
    };
    registry.observeRemoteApprovalResolutions(value.id, host.initial, changed);
    expect((await capturedRows(parent))[0]).toMatchObject({
      original: { request: { approval: { requestId: 71, occurrenceId: original } } },
      phase: "unconfirmed",
      providerAck: "unproved",
    });
    const later = {
      ...changed,
      revision: 12,
      session: {
        ...changed.session,
        blocks: changed.session.blocks.map((block) => ({
          ...block,
          approval: { ...block.approval!, occurrenceId: original },
        })),
      },
    };
    registry.observeRemoteApprovalResolutions(value.id, changed, later);
    expect(await capturedRows(parent)).toHaveLength(1); // Broken identity chain cannot be revived.
    expect(host.approve).toHaveBeenCalledExactlyOnceWith(71, "allow", original);
  });

  it("requires Native next-row nonce identity before metadata substitution and selectively validates event nonces", async () => {
    const { parent, registry } = fixture();
    const value = session();
    const occurrenceId = value.blocks[0].approval!.occurrenceId!;
    registry.submitApprovalIntent(value, 71, "deny", registry.captureApprovalRequest(value, 71));
    expect(native.wrapper).toHaveBeenCalledExactlyOnceWith(
      "codex",
      value.id,
      71,
      "deny",
      occurrenceId,
    );
    const wrong = createApprovalOccurrenceId();
    const wrongEvent = {
      type: "approval.resolved",
      requestId: 71,
      decision: "deny",
      occurrenceId: wrong,
    } as const;
    registry.observeApprovalResolutions(value, applyHarnessEvent(value, wrongEvent), [wrongEvent]);
    expect(await capturedRows(parent)).toHaveLength(1);
    const event = { ...wrongEvent, occurrenceId };
    const actual = applyHarnessEvent(value, event);
    const changed = {
      ...actual,
      blocks: actual.blocks.map((block) => ({
        ...block,
        approval: { ...block.approval!, occurrenceId: wrong },
      })),
    };
    registry.observeApprovalResolutions(value, changed, [event]);
    expect(await capturedRows(parent)).toHaveLength(1);
    registry.observeApprovalResolutions(value, actual, [event]);
    expect(await capturedRows(parent)).toHaveLength(0);
  });

  it("keeps an unidentified in-process source unqualified and refuses a new Native effect without inventing a nonce", async () => {
    const { parent, registry } = fixture();
    const value = session();
    delete value.blocks[0].approval!.occurrenceId;
    const token = registry.captureApprovalRequest(value, 71);
    expect(token).toBeDefined();
    expect(registry.submitApprovalIntent(value, 71, "allow", token)).toBe(false);
    expect(registry.approvalRequestDispatchStarted(token)).toBe(false);
    expect(native.wrapper).not.toHaveBeenCalled();
    expect(value.blocks[0].approval).not.toHaveProperty("occurrenceId");
    expect(registry.readApprovalRefusal(token)).toBe(
      "This request cannot be verified. Refresh the conversation or update its execution client.",
    );
    expect(await capturedRows(parent)).toHaveLength(0);
    const gate = parent.begin("logical-root", { owner: {}, timeoutMs: 1000 });
    try {
      const lease = await gate.capture();
      expect(lease.snapshots[0].snapshot).toMatchObject({
        qualified: false,
        rosterComplete: false,
        providerAck: "unproved",
        records: [],
      });
      lease.release();
    } finally {
      gate.release();
    }
  });
});

describe("actual approval decision Parent admission and conservation", () => {
  it("retains exact native void handoff and decision without claiming callback/provider acknowledgement or replay", async () => {
    const { parent, registry } = fixture();
    const value = session();
    const token = registry.captureApprovalRequest(value, 71, value.blocks[0]);
    expect(token).toBeDefined();
    expect(registry.submitApprovalIntent(value, 71, "deny", token)).toBe(false);
    expect(native.wrapper).toHaveBeenCalledExactlyOnceWith(
      "codex",
      value.id,
      71,
      "deny",
      value.blocks[0].approval!.occurrenceId,
    );
    expect(registry.readApprovalIntent(value, 71)).toMatchObject({
      phase: "unconfirmed",
      callback: "void",
      repeatBlocked: true,
      providerAck: "unproved",
    });
    const data = await capturedRows(parent);
    expect(data[0].original.request.text).toBe("  Original command\r\n😀  ");
    expect(data[0].original.session).toMatchObject({
      id: value.id,
      cwd: value.cwd,
      providerSessionId: "original-provider-session",
      providerAccountId: "original-account",
    });
    expect(Object.prototype.hasOwnProperty.call(data[0].original.session, "worktreeCwd")).toBe(
      true,
    );
    const rerender = { ...value };
    expect(
      registry.submitApprovalIntent(
        rerender,
        71,
        "allow",
        registry.captureApprovalRequest(rerender, 71),
      ),
    ).toBe(false);
    expect(native.wrapper).toHaveBeenCalledTimes(1);
    expect(await capturedRows(parent)).toHaveLength(1);
  });

  it("does not invent a Promise from the Native void registry even when its adapter is async", async () => {
    const { parent, registry } = fixture();
    const old = deferred();
    native.adapter = { respondApproval: vi.fn(() => old.promise) };
    const value = session();
    expect(
      registry.submitApprovalIntent(value, 71, "allow", registry.captureApprovalRequest(value, 71)),
    ).toBe(false);
    const gate = parent.begin("another-root", { owner: {}, timeoutMs: 1000 });
    try {
      const capture = await gate.capture();
      expect(rows(capture)[0]).toMatchObject({
        phase: "unconfirmed",
        callback: "void",
        providerAck: "unproved",
      });
      expect(capture.current()).toBe(true);
    } finally {
      gate.release();
      old.resolve();
    }
  });

  it.each(["fulfilled", "rejected"] as const)(
    "holds actual remote %s callback through true settlement while rejecting new ingress from every root",
    async (outcome) => {
      const { parent, registry } = fixture();
      const old = deferred();
      const approve = vi.fn(() => old.promise);
      const value = session();
      remote(value, approve);
      const sent = registry.submitApprovalIntent(
        value,
        71,
        "allow",
        registry.captureApprovalRequest(value, 71),
      );
      expect(approve).toHaveBeenCalledExactlyOnceWith(
        71,
        "allow",
        value.blocks[0].approval!.occurrenceId,
      );
      const gate = parent.begin("different-session", { owner: {}, timeoutMs: 1000 });
      const next = session(72);
      const nextToken = registry.captureApprovalRequest(next, 72);
      expect(registry.submitApprovalIntent(next, 72, "deny", nextToken)).toBe(false);
      let settled = false;
      const capturePromise = gate.capture().then((result) => {
        settled = true;
        return result;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      try {
        if (outcome === "fulfilled") old.resolve();
        else old.reject(new Error("Disconnected after dispatch"));
        await expect(sent).resolves.toBe(false);
        const capture = await capturePromise;
        expect(capture.current()).toBe(true);
        expect(gate.current()).toBe(true);
        expect(rows(capture)[0]).toMatchObject({
          callback: outcome,
          phase: outcome === "fulfilled" ? "unconfirmed" : "uncertain",
          repeatBlocked: true,
          providerAck: "unproved",
        });
        if (outcome === "rejected")
          expect(rows(capture)[0].error).toBe("Disconnected after dispatch");
        expect(
          registry.submitApprovalIntent(
            value,
            71,
            "deny",
            registry.captureApprovalRequest(value, 71),
          ),
        ).toBe(false);
        expect(native.wrapper).not.toHaveBeenCalled();
        expect(approve).toHaveBeenCalledTimes(1);
      } finally {
        gate.release();
      }
      expect(registry.submitApprovalIntent(next, 72, "deny", nextToken)).toBe(false);
      expect(native.wrapper).toHaveBeenCalledExactlyOnceWith(
        "codex",
        next.id,
        72,
        "deny",
        next.blocks[0].approval!.occurrenceId,
      );
    },
  );

  it("conserves a synchronous throw after actual callback entry as uncertain and blocks retry", async () => {
    const { parent, registry } = fixture();
    const value = session();
    const approve = vi.fn(() => {
      throw new Error("May already be delivered");
    });
    remote(value, approve);
    const token = registry.captureApprovalRequest(value, 71);
    expect(registry.submitApprovalIntent(value, 71, "allow", token)).toBe(false);
    expect(registry.readApprovalIntent(value, 71)).toMatchObject({
      phase: "uncertain",
      callback: "threw",
      error: "May already be delivered",
      repeatBlocked: true,
    });
    expect(registry.submitApprovalIntent(value, 71, "deny", token)).toBe(false);
    expect(approve).toHaveBeenCalledTimes(1);
    expect((await capturedRows(parent))[0].decision).toBe("allow");
  });

  it.each(["missing-native", "missing-remote", "unmapped-remote"] as const)(
    "records %s as a predispatch refusal with no fallback effect",
    async (missing) => {
      const { parent, registry } = fixture();
      const value = session();
      if (missing === "missing-native") native.adapter = undefined;
      else if (missing === "missing-remote") {
        remote(value, vi.fn()).stop();
      } else value.cwd = "remote://missing/G:/original-project";
      const token = registry.captureApprovalRequest(value, 71);
      expect(token).toBeDefined();
      expect(registry.submitApprovalIntent(value, 71, "allow", token)).toBe(false);
      expect(native.wrapper).not.toHaveBeenCalled();
      expect((await capturedRows(parent))[0]).toMatchObject({
        phase: "rejected",
        callback: "not-started",
        repeatBlocked: false,
        decision: "allow",
      });
    },
  );

  it.each([
    "body",
    "approval-object",
    "session",
    "owner",
    "account",
    "removed",
    "missing",
  ] as const)(
    "refuses an old rendered token after %s replacement and retains its original choice without retargeting",
    async (changed) => {
      const { parent, registry } = fixture();
      const value = session();
      const approve = vi.fn();
      remote(value, approve);
      const token = registry.captureApprovalRequest(value, 71);
      let latest: Session | undefined = value;
      if (changed === "body") value.blocks[0].text = "Different body with the same ID";
      if (changed === "approval-object")
        value.blocks[0] = { ...value.blocks[0], approval: { requestId: 71 } };
      if (changed === "session") latest = { ...value, id: "another-session" };
      if (changed === "owner")
        value.hostBinding = { ...value.hostBinding!, authorityGeneration: 5 };
      if (changed === "account") value.providerAccountId = "another-account";
      if (changed === "removed") value.worktreeRemoved = true;
      if (changed === "missing") latest = undefined;
      expect(registry.submitApprovalIntent(latest, 71, "deny", token)).toBe(false);
      expect(approve).not.toHaveBeenCalled();
      expect(native.wrapper).not.toHaveBeenCalled();
      const [saved] = await capturedRows(parent);
      expect(saved).toMatchObject({ phase: "rejected", callback: "not-started", decision: "deny" });
      expect(saved.original.request.text).toBe("  Original command\r\n😀  ");
    },
  );

  it("refuses remote detach/re-register of the SAME action object and method mutation before entry", async () => {
    const { parent, registry } = fixture();
    const value = session();
    const old = vi.fn();
    const port = remote(value, old);
    const token = registry.captureApprovalRequest(value, 71);
    port.stop();
    cleanup.push(registerRemoteSessionActions(value.id, port.actions as never));
    expect(registry.submitApprovalIntent(value, 71, "allow", token)).toBe(false);
    const next = registry.captureApprovalRequest(value, 71);
    const replacement = vi.fn();
    port.actions.approve = replacement;
    expect(registry.submitApprovalIntent(value, 71, "deny", next)).toBe(false);
    expect(old).not.toHaveBeenCalled();
    expect(replacement).not.toHaveBeenCalled();
    expect((await capturedRows(parent)).map((row) => row.phase)).toEqual(["rejected", "rejected"]);
  });

  it("requires the actual rendered block and an opaque token, not a caller-shaped or serialized DTO", () => {
    const { registry } = fixture();
    const value = session();
    expect(registry.captureApprovalRequest(value, 71, { ...value.blocks[0] })).toBeUndefined();
    expect(registry.submitApprovalIntent(value, 71, "allow")).toBe(false);
    expect(registry.submitApprovalIntent(value, 71, "allow", {} as never)).toBe(false);
    const token = registry.captureApprovalRequest(value, 71);
    expect(() => copyNativeCaptureData(token)).toThrow();
    expect(() => JSON.stringify(token)).not.toThrow();
    expect(
      registry.submitApprovalIntent(value, 71, "allow", JSON.parse(JSON.stringify(token))),
    ).toBe(false);
    expect(native.wrapper).not.toHaveBeenCalled();
  });

  it("does not dispatch ambiguous duplicate, decided or missing requests", () => {
    const { registry } = fixture();
    const value = session();
    value.blocks.push({ ...value.blocks[0], id: "duplicate", approval: { requestId: 71 } });
    expect(registry.captureApprovalRequest(value, 71)).toBeUndefined();
    value.blocks.pop();
    value.blocks[0].approval!.decided = "cancelled";
    expect(registry.captureApprovalRequest(value, 71)).toBeUndefined();
    expect(registry.captureApprovalRequest(value, 99)).toBeUndefined();
    expect(native.wrapper).not.toHaveBeenCalled();
  });

  it("revalidates the actual owner after reactive publication before callback dispatch", async () => {
    const { parent, registry } = fixture();
    const value = session();
    const approve = vi.fn();
    const port = remote(value, approve);
    registry.subscribe(port.stop);
    const token = registry.captureApprovalRequest(value, 71);
    expect(registry.submitApprovalIntent(value, 71, "allow", token)).toBe(false);
    expect(approve).not.toHaveBeenCalled();
    expect((await capturedRows(parent))[0]).toMatchObject({
      phase: "rejected",
      callback: "not-started",
      repeatBlocked: false,
    });
  });

  it("re-reads the actual synchronous Session source after reactive publication before dispatch", async () => {
    const { parent, registry } = fixture();
    const value = session();
    let current = value;
    registry.subscribe(() => {
      current = {
        ...value,
        blocks: [{ ...value.blocks[0], text: "Replacement", approval: { requestId: 71 } }],
      };
    });
    const token = registry.captureApprovalRequest(value, 71);
    registry.submitApprovalIntent(value, 71, "allow", token, () => current);
    expect(native.wrapper).not.toHaveBeenCalled();
    expect((await capturedRows(parent))[0]).toMatchObject({
      phase: "rejected",
      repeatBlocked: false,
    });
  });

  it("checks the private committed remote source, rather than trusting a stale same-ID projected Session argument", async () => {
    const { parent, registry } = fixture();
    const value = session();
    const host = hostSource(value);
    const token = registry.captureApprovalRequest(value, 71);
    host.set({
      ...host.initial,
      revision: 11,
      session: {
        ...host.initial.session,
        blocks: [{ ...value.blocks[0], text: "Other body", approval: { requestId: 71 } }],
      },
    });
    registry.submitApprovalIntent(value, 71, "allow", token);
    expect(host.approve).not.toHaveBeenCalled();
    expect((await capturedRows(parent))[0]).toMatchObject({
      phase: "rejected",
      callback: "not-started",
    });
  });

  it.each(["shadow", "pane"] as const)(
    "keeps separate exact presentation/source context and shares repeat-blocked state from %s to the other surface",
    async (origin) => {
      const { parent, registry } = fixture();
      const shadow = session();
      const pane = {
        ...shadow,
        cwd: "G:/actual-owner-worktree",
        model: "actual-owner-model",
        modelSettings: { effort: "high" },
        workspaceMode: "worktree" as const,
        worktreeCwd: "G:/actual-owner-worktree",
        providerAccountId: "actual-owner-account",
      };
      const host = hostSource(shadow, vi.fn(), pane);
      const presented = origin === "shadow" ? shadow : pane;
      const other = origin === "shadow" ? pane : shadow;
      const token = registry.captureApprovalRequest(presented, 71, presented.blocks[0]);
      expect(token).toBeDefined();
      registry.submitApprovalIntent(presented, 71, "allow", token, () => presented);
      expect(host.approve).toHaveBeenCalledExactlyOnceWith(
        71,
        "allow",
        presented.blocks[0].approval!.occurrenceId,
      );
      expect(registry.readApprovalIntent(other, 71)).toMatchObject({
        phase: "unconfirmed",
        repeatBlocked: true,
        decision: "allow",
      });
      registry.submitApprovalIntent(
        other,
        71,
        "deny",
        registry.captureApprovalRequest(other, 71),
        () => other,
      );
      expect(host.approve).toHaveBeenCalledTimes(1);
      const lease = await parent.capture("logical-root");
      try {
        const row = rows(lease)[0] as Row & {
          sourceOriginal: { session: { cwd: string; model: string; providerAccountId: string } };
        };
        expect(row.original.session.cwd).toBe(presented.cwd);
        expect(row.sourceOriginal.session).toMatchObject({
          cwd: pane.cwd,
          model: pane.model,
          providerAccountId: pane.providerAccountId,
        });
      } finally {
        lease.release();
      }
    },
  );

  it.each(["pending", "unconfirmed", "uncertain"] as const)(
    "keeps the exact original %s view visible after actual source unavailability and a display remount",
    async (phase) => {
      const { registry } = fixture();
      const value = session();
      const job = deferred();
      const host = hostSource(
        value,
        vi.fn(() => (phase === "unconfirmed" ? undefined : job.promise)),
      );
      const original = registry.captureApprovalRequest(value, 71);
      const sent = registry.submitApprovalIntent(value, 71, "allow", original);
      if (phase === "uncertain") {
        job.reject(new Error("Original disconnected"));
        await sent;
      }
      host.set(undefined);
      const remounted = { ...value, title: "Remounted original presentation" };
      expect(registry.readApprovalIntent(remounted, 71)).toMatchObject({
        phase,
        decision: "allow",
        repeatBlocked: true,
        providerAck: "unproved",
      });
      expect(registry.captureApprovalRequest(remounted, 71)).toBeUndefined();
      registry.submitApprovalIntent(remounted, 71, "deny", original);
      expect(host.approve).toHaveBeenCalledTimes(1);
      if (phase === "pending") {
        job.resolve();
        await sent;
      }
    },
  );

  it.each(["detach", "same-actions-replacement", "throwing-source"] as const)(
    "keeps original unknown visible across %s without granting another dispatch",
    (mode) => {
      const { registry } = fixture();
      const value = session();
      const host = hostSource(value);
      registry.submitApprovalIntent(value, 71, "allow", registry.captureApprovalRequest(value, 71));
      if (mode === "detach") host.detach();
      if (mode === "same-actions-replacement") {
        host.detach();
        cleanup.push(registerRemoteSessionActions(value.id, host.actions as never));
      }
      if (mode === "throwing-source")
        host.actions.approvalSource = () => {
          throw new Error("Connection unavailable");
        };
      expect(registry.readApprovalIntent({ ...value }, 71)).toMatchObject({
        phase: "unconfirmed",
        repeatBlocked: true,
        decision: "allow",
      });
      const nextToken = registry.captureApprovalRequest(value, 71);
      registry.submitApprovalIntent(value, 71, "deny", nextToken);
      expect(registry.approvalRequestDispatchStarted(nextToken)).toBe(false);
      expect(host.approve).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["shadow", "pane"] as const)(
    "preserves both exact frozen presentation/source read contexts after detach from %s",
    (origin) => {
      const { registry } = fixture();
      const shadow = session();
      const pane = {
        ...shadow,
        cwd: "G:/actual-owner",
        model: "owner-model",
        modelSettings: { effort: "high" },
        providerAccountId: "owner-account",
      };
      const host = hostSource(shadow, vi.fn(), pane);
      const presented = origin === "shadow" ? shadow : pane;
      registry.submitApprovalIntent(
        presented,
        71,
        "allow",
        registry.captureApprovalRequest(presented, 71),
      );
      host.detach();
      if (origin === "shadow") {
        expect(registry.readApprovalIntent({ ...shadow }, 71)).toMatchObject({
          phase: "unconfirmed",
          repeatBlocked: true,
        });
      } else {
        // A pane-origin capture never observed the different shadow metadata.
        // Keep the actual repeat guard visible without inventing a view join.
        expect(registry.readApprovalIntent({ ...shadow }, 71)).toBeUndefined();
      }
      expect(registry.isApprovalRequestBlocked(shadow.id, 71)).toBe(true);
      expect(registry.isApprovalRequestBlocked("other-session", 71)).toBe(false);
      expect(registry.readApprovalIntent({ ...pane }, 71)).toMatchObject({
        phase: "unconfirmed",
        repeatBlocked: true,
      });
      expect(host.approve).toHaveBeenCalledTimes(1);
    },
  );

  it("never joins an equal same-ID replacement Block/approval or different execution context in the detached read fallback", () => {
    const { registry } = fixture();
    const value = session();
    const host = hostSource(value);
    registry.submitApprovalIntent(value, 71, "allow", registry.captureApprovalRequest(value, 71));
    host.detach();
    expect(
      registry.readApprovalIntent({ ...value, blocks: [{ ...value.blocks[0] }] }, 71),
    ).toBeUndefined();
    expect(registry.readApprovalIntent({ ...value, cwd: "G:/other-context" }, 71)).toBeUndefined();
    expect(registry.isApprovalRequestBlocked(value.id, 71)).toBe(true);
    expect(registry.readApprovalIntent({ ...value, id: "other-session" }, 71)).toBeUndefined();
    value.blocks[0].approval = { requestId: 71 };
    expect(registry.readApprovalIntent(value, 71)).toBeUndefined();
    expect(host.approve).toHaveBeenCalledTimes(1);
  });

  it("does not issue a remote render token unless presentation and actual source share the unique original request objects", () => {
    const { registry } = fixture();
    const shadow = session();
    const pane = { ...shadow, blocks: [{ ...shadow.blocks[0], approval: { requestId: 71 } }] };
    const host = hostSource(shadow, vi.fn(), pane);
    expect(registry.captureApprovalRequest(shadow, 71)).toBeUndefined();
    expect(host.approve).not.toHaveBeenCalled();
  });

  it("follows actual accepted remote snapshots, keeps unknown view state across immutable projection and retires only the represented resolved original", async () => {
    const { parent, registry } = fixture({ records: 1 });
    const value = session();
    const host = hostSource(value);
    registry.submitApprovalIntent(value, 71, "allow", registry.captureApprovalRequest(value, 71));
    expect(host.approve).toHaveBeenCalledTimes(1);
    const next: HostSession = {
      ...host.initial,
      revision: 11,
      session: {
        ...host.initial.session,
        blocks: host.initial.session.blocks.map((block) => ({
          ...block,
          approval: { ...block.approval! },
        })),
      },
    };
    registry.observeRemoteApprovalResolutions(value.id, host.initial, next);
    const projected = host.set(next)!;
    expect(registry.readApprovalIntent(projected, 71)).toMatchObject({
      phase: "unconfirmed",
      repeatBlocked: true,
      providerAck: "unproved",
    });
    const saved = await capturedRows(parent);
    expect((saved[0].original.route as { source?: { revision: number } }).source?.revision).toBe(
      10,
    );
    const resolved = {
      ...next,
      revision: 12,
      session: applyHarnessEvent(next.session, {
        type: "approval.resolved",
        requestId: 71,
        decision: "allow",
      }),
    };
    registry.observeRemoteApprovalResolutions(value.id, next, resolved);
    host.set(resolved);
    expect(await capturedRows(parent)).toHaveLength(0);
    const fresh = {
      ...resolved,
      revision: 13,
      session: {
        ...resolved.session,
        blocks: [
          ...resolved.session.blocks,
          {
            id: "fresh-71",
            role: "approval" as const,
            text: "Genuinely new original request",
            approval: { requestId: 71, occurrenceId: createApprovalOccurrenceId() },
          },
        ],
      },
    };
    const current = host.set(fresh)!;
    registry.submitApprovalIntent(
      current,
      71,
      "deny",
      registry.captureApprovalRequest(current, 71),
    );
    expect(host.approve).toHaveBeenCalledTimes(2);
  });

  it.each(["absence", "body", "run", "authority", "revision", "preview"] as const)(
    "does not revive the original remote source after %s breaks its accepted chain",
    async (failure) => {
      const { parent, registry } = fixture({ records: 1 });
      const value = session();
      const host = hostSource(value);
      registry.submitApprovalIntent(value, 71, "allow", registry.captureApprovalRequest(value, 71));
      let bad: HostSession = { ...host.initial, revision: 11 };
      if (failure === "absence") bad = { ...bad, session: { ...bad.session, blocks: [] } };
      if (failure === "body")
        bad = {
          ...bad,
          session: {
            ...bad.session,
            blocks: [{ ...bad.session.blocks[0], text: "Other original" }],
          },
        };
      if (failure === "run") bad = { ...bad, runId: "replacement-run" };
      if (failure === "authority") bad = { ...bad, authorityGeneration: 5 };
      if (failure === "revision") bad = { ...bad, revision: 9 };
      if (failure === "preview")
        bad = {
          ...bad,
          session: {
            ...bad.session,
            blocks: [
              {
                ...bad.session.blocks[0],
                remoteContent: { revision: 11, bytes: 100, digest: "preview" },
              },
            ],
          },
        };
      registry.observeRemoteApprovalResolutions(value.id, host.initial, bad);
      const revived = { ...host.initial, revision: 12 };
      registry.observeRemoteApprovalResolutions(value.id, bad, revived);
      host.set(revived);
      const resolved = {
        ...revived,
        revision: 13,
        session: applyHarnessEvent(revived.session, {
          type: "approval.resolved",
          requestId: 71,
          decision: "allow",
        }),
      };
      registry.observeRemoteApprovalResolutions(value.id, revived, resolved);
      expect(await capturedRows(parent)).toHaveLength(1);
      const next = session(72);
      registry.submitApprovalIntent(next, 72, "allow", registry.captureApprovalRequest(next, 72));
      expect(host.approve).toHaveBeenCalledTimes(1);
      expect(native.wrapper).not.toHaveBeenCalled();
    },
  );

  it("does not treat an equal copied before-snapshot or unchanged revision as a resolved original receipt", async () => {
    const { parent, registry } = fixture();
    const value = session();
    const host = hostSource(value);
    registry.submitApprovalIntent(value, 71, "deny", registry.captureApprovalRequest(value, 71));
    const decided = {
      ...host.initial,
      revision: 11,
      session: applyHarnessEvent(host.initial.session, {
        type: "approval.resolved",
        requestId: 71,
        decision: "deny",
      }),
    };
    registry.observeRemoteApprovalResolutions(value.id, { ...host.initial }, decided);
    expect(await capturedRows(parent)).toHaveLength(1);
    registry.observeRemoteApprovalResolutions(value.id, host.initial, {
      ...decided,
      revision: host.initial.revision,
    });
    expect(await capturedRows(parent)).toHaveLength(1);
  });

  it.each(["history", "preview", "full-block"] as const)(
    "carries the exact original cursor across unrelated %s expansion without acknowledgement and then retires the genuine resolved poll",
    async (kind) => {
      const { parent, registry } = fixture();
      const value = session();
      if (kind !== "history")
        value.blocks.push({
          id: "unrelated-output",
          role: "tool",
          text: "Bounded stub",
          remoteContent: { revision: 10, bytes: 10000, digest: "unrelated" },
        });
      const host = hostSource(value);
      registry.submitApprovalIntent(value, 71, "allow", registry.captureApprovalRequest(value, 71));
      const retained = await parent.capture("logical-root");
      const originalRaw = rows(retained)[0];
      const extra: Block = {
        id: "unrelated-output",
        role: "tool",
        text: kind === "preview" ? "unrelated preview" : "full unrelated output",
        ...(kind === "preview"
          ? { remoteContent: { revision: 10, bytes: 10000, digest: "unrelated" } }
          : {}),
      };
      const expanded: HostSession = {
        ...host.initial,
        session: {
          ...host.initial.session,
          blocks:
            kind === "history"
              ? [extra, ...host.initial.session.blocks]
              : host.initial.session.blocks.map((block) => (block.id === extra.id ? extra : block)),
        },
      };
      registry.observeRemoteApprovalSourceExpansion(value.id, host.initial, expanded);
      const projected = host.set(expanded)!;
      expect(registry.readApprovalIntent(projected, 71)).toMatchObject({
        phase: "unconfirmed",
        repeatBlocked: true,
        providerAck: "unproved",
      });
      expect(rows(retained)[0]).toEqual(originalRaw);
      expect(retained.current()).toBe(true);
      expect(parent.inspect().pendingJobs).toBe(0);
      const resolved = {
        ...expanded,
        revision: 11,
        session: applyHarnessEvent(expanded.session, {
          type: "approval.resolved",
          requestId: 71,
          decision: "allow",
        }),
      };
      registry.observeRemoteApprovalResolutions(value.id, expanded, resolved);
      expect(retained.current()).toBe(false);
      retained.release();
      expect(await capturedRows(parent)).toHaveLength(0);
      expect(host.approve).toHaveBeenCalledTimes(1);
      expect(native.wrapper).not.toHaveBeenCalled();
    },
  );

  it.each(["decided", "missing", "changed", "revision", "owner", "run"] as const)(
    "breaks/refuses %s in a purported data expansion without resolving or reviving the original",
    async (failure) => {
      const { parent, registry } = fixture();
      const value = session();
      const host = hostSource(value);
      registry.submitApprovalIntent(value, 71, "deny", registry.captureApprovalRequest(value, 71));
      let expanded: HostSession = { ...host.initial, session: { ...host.initial.session } };
      if (failure === "decided")
        expanded = {
          ...expanded,
          session: applyHarnessEvent(expanded.session, {
            type: "approval.resolved",
            requestId: 71,
            decision: "deny",
          }),
        };
      if (failure === "missing")
        expanded = { ...expanded, session: { ...expanded.session, blocks: [] } };
      if (failure === "changed")
        expanded = {
          ...expanded,
          session: {
            ...expanded.session,
            blocks: [{ ...expanded.session.blocks[0], text: "Replacement meaning" }],
          },
        };
      if (failure === "revision") expanded = { ...expanded, revision: 11 };
      if (failure === "owner") expanded = { ...expanded, authorityGeneration: 5 };
      if (failure === "run") expanded = { ...expanded, runId: "replacement-run" };
      registry.observeRemoteApprovalSourceExpansion(value.id, host.initial, expanded);
      expect((await capturedRows(parent))[0]).toMatchObject({
        phase: "unconfirmed",
        callback: "void",
        decision: "deny",
        providerAck: "unproved",
      });
      const revived = { ...host.initial, revision: 12 };
      registry.observeRemoteApprovalResolutions(value.id, expanded, revived);
      const resolved = {
        ...revived,
        revision: 13,
        session: applyHarnessEvent(revived.session, {
          type: "approval.resolved",
          requestId: 71,
          decision: "deny",
        }),
      };
      registry.observeRemoteApprovalResolutions(value.id, revived, resolved);
      expect(await capturedRows(parent)).toHaveLength(1);
      expect(host.approve).toHaveBeenCalledTimes(1);
    },
  );

  it("does not carry a cursor from an equal copied before-snapshot", async () => {
    const { parent, registry } = fixture();
    const value = session();
    const host = hostSource(value);
    registry.submitApprovalIntent(value, 71, "allow", registry.captureApprovalRequest(value, 71));
    const expanded = {
      ...host.initial,
      session: { ...host.initial.session, blocks: [...host.initial.session.blocks] },
    };
    registry.observeRemoteApprovalSourceExpansion(value.id, { ...host.initial }, expanded);
    const resolved = {
      ...expanded,
      revision: 11,
      session: applyHarnessEvent(expanded.session, {
        type: "approval.resolved",
        requestId: 71,
        decision: "allow",
      }),
    };
    registry.observeRemoteApprovalResolutions(value.id, expanded, resolved);
    expect(await capturedRows(parent)).toHaveLength(1);
    expect(host.approve).toHaveBeenCalledTimes(1);
  });

  it("does not release a represented remote original until its genuine returned callback settles", async () => {
    const { parent, registry } = fixture();
    const value = session();
    const job = deferred();
    const host = hostSource(
      value,
      vi.fn(() => job.promise),
    );
    const sent = registry.submitApprovalIntent(
      value,
      71,
      "allow",
      registry.captureApprovalRequest(value, 71),
    );
    const decided = {
      ...host.initial,
      revision: 11,
      session: applyHarnessEvent(host.initial.session, {
        type: "approval.resolved",
        requestId: 71,
        decision: "allow",
      }),
    };
    registry.observeRemoteApprovalResolutions(value.id, host.initial, decided);
    host.set(decided);
    expect(await capturedRows(parent)).toHaveLength(1);
    const gate = parent.begin("logical-root", { owner: {}, timeoutMs: 1000 });
    const waiting = gate.capture();
    job.resolve();
    await expect(sent).resolves.toBe(false);
    try {
      const capture = await waiting;
      expect(capture.current()).toBe(true);
      expect(rows(capture)).toHaveLength(0);
    } finally {
      gate.release();
    }
  });

  it("keeps unknown records within the actual 64-record bound and refuses the 65th before effects without eviction", async () => {
    const { parent, registry } = fixture();
    for (let index = 0; index < 64; index++) {
      const value = session(index);
      registry.submitApprovalIntent(
        value,
        index,
        "allow",
        registry.captureApprovalRequest(value, index),
      );
    }
    expect(native.wrapper).toHaveBeenCalledTimes(64);
    const overflow = session(65);
    const overflowToken = registry.captureApprovalRequest(overflow, 65);
    expect(registry.submitApprovalIntent(overflow, 65, "deny", overflowToken)).toBe(false);
    expect(registry.readApprovalRefusal(overflowToken)).toContain("storage is full");
    expect(native.wrapper).toHaveBeenCalledTimes(64);
    const saved = await capturedRows(parent);
    expect(saved).toHaveLength(64);
    expect(saved[0].original.request.approval?.requestId).toBe(0);
    expect(saved[63].original.request.approval?.requestId).toBe(63);
  });

  it("bounds aggregate exact data plus future outcomes before another effect", async () => {
    const { parent, registry } = fixture({ bytes: 8192 });
    const first = session(1);
    registry.submitApprovalIntent(first, 1, "allow", registry.captureApprovalRequest(first, 1));
    expect(native.wrapper).toHaveBeenCalledTimes(1);
    const next = session(2);
    expect(registry.captureApprovalRequest(next, 2)).toBeDefined();
    expect(
      registry.submitApprovalIntent(next, 2, "deny", registry.captureApprovalRequest(next, 2)),
    ).toBe(false);
    expect(native.wrapper).toHaveBeenCalledTimes(1);
    expect(await capturedRows(parent)).toHaveLength(1);
    expect(registry.captureApprovalRequest(session(3, "x".repeat(8192)), 3)).toBeUndefined();
  });

  it("never uses an unrecorded Parent overflow registration as an execution permit", () => {
    const parent = new ParentInputRegistry({ records: 1 });
    parent.register({
      kind: "session-parent",
      sessionId: "other",
      snapshot: () => ({ text: "retained original" }),
    });
    const registry = createApprovalIntentRegistry({
      register: (adapter) => parent.register(adapter),
    });
    const value = session();
    expect(
      registry.submitApprovalIntent(value, 71, "allow", registry.captureApprovalRequest(value, 71)),
    ).toBe(false);
    expect(native.wrapper).not.toHaveBeenCalled();
    expect(parent.inspect().overflow).toBe(1);
  });

  it("keeps unknown original handoff separate from later genuine request occurrences", async () => {
    const { parent, registry } = fixture();
    const value = session();
    registry.submitApprovalIntent(value, 71, "allow", registry.captureApprovalRequest(value, 71));
    const old = registry.readApprovalIntent(value, 71);
    const copied = {
      ...value,
      blocks: value.blocks.map((block) => ({ ...block, approval: { requestId: 71 } })),
    };
    expect(registry.readApprovalIntent(copied, 71)).toBeUndefined();
    expect(
      registry.submitApprovalIntent(
        copied,
        71,
        "deny",
        registry.captureApprovalRequest(copied, 71),
      ),
    ).toBe(false);
    expect(old?.repeatBlocked).toBe(true);
    copied.blocks = [
      {
        id: "new",
        role: "approval",
        text: "Genuine next request",
        approval: { requestId: 72, occurrenceId: createApprovalOccurrenceId() },
      },
    ];
    registry.submitApprovalIntent(copied, 72, "deny", registry.captureApprovalRequest(copied, 72));
    expect(native.wrapper).toHaveBeenCalledTimes(2);
    expect(
      (await capturedRows(parent)).map((row) => row.original.request.approval?.requestId),
    ).toEqual([71, 72]);
  });

  it("refuses a changed durable Host binding even when the display Session still has the original owner", async () => {
    const { parent, registry } = fixture();
    const value = session();
    const approve = vi.fn();
    remote(value, approve);
    const token = registry.captureApprovalRequest(value, 71);
    saveHostSessionBinding(value, { ...value.hostBinding!, authorityGeneration: 5 });
    expect(registry.submitApprovalIntent(value, 71, "allow", token)).toBe(false);
    expect(approve).not.toHaveBeenCalled();
    expect((await capturedRows(parent))[0].phase).toBe("rejected");
  });

  it("accepts an unrelated immutable Session update while preserving the actual original request objects", () => {
    const { registry } = fixture();
    const value = session();
    const token = registry.captureApprovalRequest(value, 71);
    const latest = { ...value, title: "Updated conversation title" };
    registry.submitApprovalIntent(latest, 71, "allow", token);
    expect(native.wrapper).toHaveBeenCalledExactlyOnceWith(
      "codex",
      value.id,
      71,
      "allow",
      value.blocks[0].approval!.occurrenceId,
    );
  });

  it("releases capacity only after actual applied original resolution, allowing more than 64 ordinary resolved requests", async () => {
    const { parent, registry } = fixture({ records: 1 });
    let value = session(1);
    for (let id = 1; id <= 70; id++) {
      value = {
        ...value,
        blocks: [
          {
            id: `actual-${id}`,
            role: "approval",
            text: `Original request ${id}`,
            approval: { requestId: id, occurrenceId: createApprovalOccurrenceId() },
          },
        ],
      };
      registry.submitApprovalIntent(value, id, "allow", registry.captureApprovalRequest(value, id));
      const event = { type: "approval.resolved", requestId: id, decision: "allow" } as const;
      const applied = applyHarnessEvent(value, event);
      registry.observeApprovalResolutions(value, applied, [event]);
      expect(applied.blocks[0].approval?.decided).toBe("allow");
      expect(await capturedRows(parent)).toHaveLength(0);
      value = applied;
    }
    expect(native.wrapper).toHaveBeenCalledTimes(70);
  });

  it("does not release unknown on absence, disconnected/replaced request, or decided display without the original applied event", async () => {
    const { parent, registry } = fixture({ records: 1 });
    const value = session();
    registry.submitApprovalIntent(value, 71, "allow", registry.captureApprovalRequest(value, 71));
    const event = { type: "approval.resolved", requestId: 71, decision: "allow" } as const;
    const applied = applyHarnessEvent(value, event);
    registry.observeApprovalResolutions(value, { ...value, blocks: [] }, [event]);
    registry.observeApprovalResolutions(value, applied, []);
    const replaced = {
      ...value,
      blocks: value.blocks.map((block) => ({ ...block, approval: { requestId: 71 } })),
    };
    registry.observeApprovalResolutions(replaced, applyHarnessEvent(replaced, event), [event]);
    expect(await capturedRows(parent)).toHaveLength(1);
    const next = session(72);
    registry.submitApprovalIntent(next, 72, "deny", registry.captureApprovalRequest(next, 72));
    expect(native.wrapper).toHaveBeenCalledTimes(1);
    registry.observeApprovalResolutions(value, applied, [event]);
    registry.submitApprovalIntent(next, 72, "deny", registry.captureApprovalRequest(next, 72));
    expect(native.wrapper).toHaveBeenCalledTimes(2);
  });

  it("retains original live callback ownership after source resolution until its actual Promise finishes", async () => {
    const { parent, registry } = fixture({ records: 1 });
    const value = session();
    const old = deferred();
    const approve = vi.fn(() => old.promise);
    remote(value, approve);
    const sent = registry.submitApprovalIntent(
      value,
      71,
      "deny",
      registry.captureApprovalRequest(value, 71),
    );
    const event = { type: "approval.resolved", requestId: 71, decision: "deny" } as const;
    registry.observeApprovalResolutions(value, applyHarnessEvent(value, event), [event]);
    expect(await capturedRows(parent)).toHaveLength(1);
    const gate = parent.begin("logical-root", { owner: {}, timeoutMs: 1000 });
    const waiting = gate.capture();
    old.resolve();
    await expect(sent).resolves.toBe(false);
    try {
      const lease = await waiting;
      expect(lease.current()).toBe(true);
      expect(rows(lease)).toHaveLength(0);
      expect(approve).toHaveBeenCalledTimes(1);
    } finally {
      gate.release();
    }
  });

  it("permits a genuinely new same-ID occurrence only after the exact previous original is represented as resolved", async () => {
    const { parent, registry } = fixture();
    const value = session();
    registry.submitApprovalIntent(value, 71, "allow", registry.captureApprovalRequest(value, 71));
    const event = { type: "approval.resolved", requestId: 71, decision: "allow" } as const;
    const resolved = applyHarnessEvent(value, event);
    registry.observeApprovalResolutions(value, resolved, [event]);
    const next = {
      ...value,
      blocks: [
        ...resolved.blocks,
        {
          id: "new-original",
          role: "approval" as const,
          text: "Real new request, provider reused ID",
          approval: { requestId: 71, occurrenceId: createApprovalOccurrenceId() },
        },
      ],
    };
    registry.submitApprovalIntent(next, 71, "deny", registry.captureApprovalRequest(next, 71));
    expect(native.wrapper).toHaveBeenCalledTimes(2);
    expect((await capturedRows(parent))[0]).toMatchObject({
      decision: "deny",
      phase: "unconfirmed",
      providerAck: "unproved",
    });
  });

  it("observes no callback start for actual closure/capacity refusal or a forged token", () => {
    const { parent, registry } = fixture({ records: 1 });
    const value = session();
    const token = registry.captureApprovalRequest(value, 71);
    const gate = parent.begin("logical-root", { owner: {}, timeoutMs: 1000 });
    try {
      registry.submitApprovalIntent(value, 71, "allow", token);
      expect(registry.approvalRequestDispatchStarted(token)).toBe(false);
      expect(native.wrapper).not.toHaveBeenCalled();
    } finally {
      gate.release();
    }
    registry.submitApprovalIntent(value, 71, "allow", token);
    expect(registry.approvalRequestDispatchStarted(token)).toBe(true);
    const next = session(72);
    const overflow = registry.captureApprovalRequest(next, 72);
    registry.submitApprovalIntent(next, 72, "deny", overflow);
    expect(registry.approvalRequestDispatchStarted(overflow)).toBe(false);
    expect(registry.approvalRequestDispatchStarted({} as never)).toBe(false);
    expect(registry.approvalRequestDispatchStarted(undefined)).toBe(false);
    expect(native.wrapper).toHaveBeenCalledTimes(1);
  });

  it.each(["void", "throw", "promise-fulfilled", "promise-rejected"] as const)(
    "observes actual %s entry without asserting provider acknowledgement",
    async (outcome) => {
      const { registry } = fixture();
      const value = session();
      const job = deferred();
      const approve = vi.fn(() => {
        if (outcome === "throw") throw new Error("May already be delivered");
        if (outcome.startsWith("promise")) return job.promise;
      });
      remote(value, approve);
      const token = registry.captureApprovalRequest(value, 71);
      expect(registry.approvalRequestDispatchStarted(token)).toBe(false);
      const sent = registry.submitApprovalIntent(value, 71, "allow", token);
      expect(registry.approvalRequestDispatchStarted(token)).toBe(true);
      if (outcome === "promise-fulfilled") job.resolve();
      if (outcome === "promise-rejected") job.reject(new Error("Actual callback rejection"));
      await sent;
      expect(registry.approvalRequestDispatchStarted(token)).toBe(true);
      expect(registry.readApprovalIntent(value, 71)?.providerAck).toBe("unproved");
      expect(approve).toHaveBeenCalledTimes(1);
      const differentToken = registry.captureApprovalRequest(value, 71);
      registry.submitApprovalIntent(value, 71, "deny", differentToken);
      expect(registry.approvalRequestDispatchStarted(differentToken)).toBe(false);
    },
  );

  it("keeps callback-start false when synchronous listener reentry replaces the actual source before invocation", () => {
    const { registry } = fixture();
    const value = session();
    const token = registry.captureApprovalRequest(value, 71);
    let current = value;
    registry.subscribe(() => {
      current = {
        ...value,
        blocks: [{ ...value.blocks[0], text: "Replacement", approval: { requestId: 71 } }],
      };
    });
    registry.submitApprovalIntent(value, 71, "allow", token, () => current);
    expect(registry.approvalRequestDispatchStarted(token)).toBe(false);
    expect(native.wrapper).not.toHaveBeenCalled();
  });

  it("keeps actual callback-start true after synchronous authoritative source resolution retires the record", async () => {
    const { parent, registry } = fixture();
    const value = session();
    const approve = vi.fn(() => {
      const event = { type: "approval.resolved", requestId: 71, decision: "allow" } as const;
      registry.observeApprovalResolutions(value, applyHarnessEvent(value, event), [event]);
    });
    remote(value, approve);
    const token = registry.captureApprovalRequest(value, 71);
    registry.submitApprovalIntent(value, 71, "allow", token);
    expect(await capturedRows(parent)).toHaveLength(0);
    expect(registry.approvalRequestDispatchStarted(token)).toBe(true);
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it("preserves original pending/unknown data across model reload without reviving old render tokens or dropping the original callback", async () => {
    const original = await import("./approvalIntents");
    const value = session();
    const job = deferred();
    const approve = vi.fn(() => job.promise);
    remote(value, approve);
    const token = original.captureApprovalRequest(value, 71);
    const sent = original.submitApprovalIntent(value, 71, "allow", token);
    vi.resetModules();
    const reloaded = await import("./approvalIntents");
    expect(reloaded.readApprovalIntent(value, 71)).toMatchObject({
      phase: "pending",
      decision: "allow",
      repeatBlocked: true,
    });
    expect(reloaded.submitApprovalIntent(value, 71, "deny", token)).toBe(false);
    expect(original.captureApprovalRequest(value, 71)).toBeUndefined();
    job.reject(new Error("Original callback failed after reload"));
    await expect(sent).resolves.toBe(false);
    expect(reloaded.readApprovalIntent(value, 71)).toMatchObject({
      phase: "uncertain",
      callback: "rejected",
      error: "Original callback failed after reload",
      decision: "allow",
    });
    expect(approve).toHaveBeenCalledTimes(1);
  });
});
