// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApprovalActions } from "./useApprovalActions";
import {
  captureApprovalRequest,
  approvalRequestDispatchStarted,
  readApprovalIntent,
  useApprovalIntent,
} from "../../../features/sessions/model/approvalIntents";
import { beginParentInputClosure } from "../../../features/sessions/data/parentInputClosure";
import { registerRemoteSessionActions } from "../../../features/connections/model/remoteSessionActions";
import { newSession, type Session } from "../../../features/sessions/model/session";
import { createApprovalOccurrenceId } from "../../../shared/model/approvalOccurrence";
import { consumeViewDelegated } from "../../../features/sessions/ui/delegatedFocus";

const native = vi.hoisted(() => ({
  approve: vi.fn(),
  answer: vi.fn(),
  keepOpen: vi.fn(),
  adapter: { respondApproval: vi.fn() },
}));
vi.mock("../../../integrations/harness", () => ({
  getHarness: () => native.adapter,
  respondHarnessApproval: native.approve,
  respondHarnessQuestion: native.answer,
  keepHarnessQuestionOpen: native.keepOpen,
}));
vi.mock("../../../features/orchestration/model/orchestration", () => ({
  orchestrator: { forSession: () => undefined },
}));
const cleanups: (() => void | Promise<void>)[] = [];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  native.approve.mockClear();
});
afterEach(async () => {
  for (const stop of cleanups.splice(0).reverse()) await stop();
  vi.unstubAllGlobals();
});
function request(id = 71) {
  const value = newSession("codex", "G:/original");
  // A pending approval request exists only while its turn is running.
  value.busy = true;
  value.blocks = [
    {
      id: crypto.randomUUID(),
      role: "approval",
      text: "  original approved command\r\n😀  ",
      approval: { requestId: id, occurrenceId: createApprovalOccurrenceId() },
    },
  ];
  return value;
}
async function mount(value: Session) {
  const sessionsRef = { current: [value] };
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  let actions!: ReturnType<typeof useApprovalActions>;
  function Fixture() {
    actions = useApprovalActions({
      sessionsRef,
      setInspectedWorkerId: vi.fn(),
      focusOpenSession: () => true,
      onSelectHistorySession: async () => {},
    });
    const current = sessionsRef.current[0];
    const intent = useApprovalIntent(current, current.blocks[0]?.approval?.requestId ?? -1);
    return createElement("output", null, intent?.phase ?? "none");
  }
  await act(async () => root.render(createElement(Fixture)));
  let mounted = true;
  const unmount = async () => {
    if (mounted) {
      mounted = false;
      await act(async () => root.unmount());
      element.remove();
    }
  };
  cleanups.push(unmount);
  return {
    actions,
    sessionsRef,
    element,
    unmount,
    rerender: () => act(async () => root.render(createElement(Fixture))),
  };
}

it("does not answer a question after the original turn guard changes", async () => {
  const value = request();
  value.pendingQuestion = { requestId: 7, questions: [] } as Session["pendingQuestion"];
  const fixture = await mount(value);
  native.answer.mockClear();
  fixture.actions.onQuestionReply(value.id, 7, { kind: "dismissed" } as never, () => false);
  expect(native.answer).not.toHaveBeenCalled();
});
it("does not redirect a guarded answer to a replacement Host owner", async () => {
  native.answer.mockClear();
  const value = request();
  value.pendingQuestion = { requestId: 7, questions: [] } as Session["pendingQuestion"];
  const fixture = await mount(value);
  const answer = vi.fn();
  value.hostBinding = {
    kind: "local-host",
    machineId: "machine",
    environmentId: "home",
    projectId: "project",
    sessionId: value.id,
    authorityGeneration: 1,
    created: true,
  };
  cleanups.push(registerRemoteSessionActions(value.id, { answer } as never));
  fixture.actions.onQuestionReply(value.id, 7, { kind: "dismissed" } as never, () => true);
  expect(answer).not.toHaveBeenCalled();
  expect(native.answer).not.toHaveBeenCalled();
});
function remote(value: Session, approve: (...args: unknown[]) => unknown) {
  value.hostBinding = {
    kind: "local-host",
    machineId: "machine",
    environmentId: "home",
    projectId: "project",
    sessionId: "actual-host-session",
    authorityGeneration: 1,
    created: true,
  };
  const actions = { approve, approvalOccurrenceSupported: true };
  const detach = registerRemoteSessionActions(value.id, actions as never);
  cleanups.push(detach);
  return { actions, detach };
}

it("requires a render-issued token through the actual hook and reacts to unconfirmed void handoff", async () => {
  const value = request();
  const mounted = await mount(value);
  expect(mounted.actions.onApproval(value.id, 71, "allow")).toBe(false);
  expect(native.approve).not.toHaveBeenCalled();
  const token = captureApprovalRequest(value, 71, value.blocks[0]);
  expect(token).toBeDefined();
  await act(async () => {
    expect(mounted.actions.onApproval(value.id, 71, "deny", token)).toBe(false);
  });
  expect(approvalRequestDispatchStarted(token)).toBe(true);
  expect(native.approve).toHaveBeenCalledExactlyOnceWith(
    "codex",
    value.id,
    71,
    "deny",
    value.blocks[0].approval!.occurrenceId,
  );
  expect(mounted.element.textContent).toBe("unconfirmed");
  expect(readApprovalIntent(value, 71)).toMatchObject({
    callback: "void",
    repeatBlocked: true,
    providerAck: "unproved",
  });
  await act(async () => {
    mounted.actions.onApproval(value.id, 71, "allow", captureApprovalRequest(value, 71));
  });
  expect(native.approve).toHaveBeenCalledTimes(1);
});

it("does not retarget an old rendered same-ID request through stable hook refs", async () => {
  const value = request();
  const mounted = await mount(value);
  const original = captureApprovalRequest(value, 71, value.blocks[0]);
  expect(original).toBeDefined();
  const latest = {
    ...value,
    blocks: [
      {
        ...value.blocks[0],
        text: "Replacement dangerous command",
        approval: { requestId: 71, occurrenceId: createApprovalOccurrenceId() },
      },
    ],
  };
  mounted.sessionsRef.current = [latest];
  await mounted.rerender();
  await act(async () => {
    expect(mounted.actions.onApproval(value.id, 71, "allow", original)).toBe(false);
  });
  expect(native.approve).not.toHaveBeenCalled();
  expect(approvalRequestDispatchStarted(original)).toBe(false);
  const fresh = captureApprovalRequest(latest, 71, latest.blocks[0]);
  expect(fresh).toBeDefined();
  await act(async () => {
    mounted.actions.onApproval(latest.id, 71, "deny", fresh);
  });
  expect(approvalRequestDispatchStarted(fresh)).toBe(true);
  expect(native.approve).toHaveBeenCalledExactlyOnceWith(
    "codex",
    value.id,
    71,
    "deny",
    latest.blocks[0].approval!.occurrenceId,
  );
});

it("holds the real remote callback across UI unmount, retains exact choice/error and blocks fresh ingress until release", async () => {
  const value = request();
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_, no) => {
    reject = no;
  });
  const approve = vi.fn(() => pending);
  remote(value, approve);
  const mounted = await mount(value);
  let sent!: boolean | Promise<boolean>;
  const token = captureApprovalRequest(value, 71);
  expect(token).toBeDefined();
  await act(async () => {
    sent = mounted.actions.onApproval(value.id, 71, "allow", token);
  });
  expect(mounted.element.textContent).toBe("pending");
  expect(approvalRequestDispatchStarted(token)).toBe(true);
  expect(approve).toHaveBeenCalledExactlyOnceWith(
    71,
    "allow",
    value.blocks[0].approval!.occurrenceId,
  );
  const gate = beginParentInputClosure("unrelated-root", { owner: {}, timeoutMs: 1000 });
  cleanups.push(gate.release);
  const captured = gate.capture();
  let ready = false;
  void captured.then(() => {
    ready = true;
  });
  await Promise.resolve();
  expect(ready).toBe(false);
  const next = request(72);
  mounted.sessionsRef.current = [value, next];
  const nextToken = captureApprovalRequest(next, 72);
  expect(nextToken).toBeDefined();
  expect(mounted.actions.onApproval(next.id, 72, "deny", nextToken)).toBe(false);
  expect(approvalRequestDispatchStarted(nextToken)).toBe(false);
  await mounted.unmount();
  reject(new Error("Original owner disconnected"));
  await expect(sent).resolves.toBe(false);
  const lease = await captured;
  expect(lease.current()).toBe(true);
  expect(gate.current()).toBe(true);
  const actor = lease.snapshots.find((row) => row.kind === "approval-decision");
  const serialized = JSON.stringify(actor?.snapshot);
  expect(serialized).toContain("original approved command\\r\\n😀");
  expect(serialized).toContain("Original owner disconnected");
  expect(readApprovalIntent(value, 71)).toMatchObject({
    phase: "uncertain",
    decision: "allow",
    callback: "rejected",
    repeatBlocked: true,
  });
  expect(approve).toHaveBeenCalledTimes(1);
  expect(native.approve).not.toHaveBeenCalled();
  const remounted = await mount(value);
  expect(remounted.element.textContent).toBe("uncertain");
  expect(
    remounted.actions.onApproval(value.id, 71, "deny", captureApprovalRequest(value, 71)),
  ).toBe(false);
  gate.release();
  await act(async () => {
    remounted.actions.onApproval(value.id, 71, "deny", captureApprovalRequest(value, 71));
  });
  expect(approve).toHaveBeenCalledTimes(1);
});

it("refuses a detached same-object remote owner without local fallback and retains the original predispatch decision", async () => {
  const value = request();
  const approve = vi.fn();
  const port = remote(value, approve);
  const mounted = await mount(value);
  const token = captureApprovalRequest(value, 71);
  expect(token).toBeDefined();
  port.detach();
  cleanups.push(registerRemoteSessionActions(value.id, port.actions as never));
  await act(async () => {
    expect(mounted.actions.onApproval(value.id, 71, "allow", token)).toBe(false);
  });
  expect(approve).not.toHaveBeenCalled();
  expect(approvalRequestDispatchStarted(token)).toBe(false);
  expect(native.approve).not.toHaveBeenCalled();
  expect(readApprovalIntent(value, 71)).toMatchObject({
    phase: "rejected",
    callback: "not-started",
    repeatBlocked: false,
  });
});

it("does not invoke a changed or removed session and preserves the original captured attempt", async () => {
  const value = request();
  const mounted = await mount(value);
  const token = captureApprovalRequest(value, 71);
  expect(token).toBeDefined();
  mounted.sessionsRef.current = [];
  expect(mounted.actions.onApproval(value.id, 71, "deny", token)).toBe(false);
  expect(native.approve).not.toHaveBeenCalled();
  expect(approvalRequestDispatchStarted(token)).toBe(false);
  expect(readApprovalIntent(value, 71)).toMatchObject({
    phase: "rejected",
    decision: "deny",
    callback: "not-started",
  });
});

it("never opens a missing session from a stale cross-window focus request", async () => {
  const value = request();
  const focus = vi.fn(() => false);
  const open = vi.fn(async () => {});
  const inspected = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let actions!: ReturnType<typeof useApprovalActions>;
  function Fixture() {
    actions = useApprovalActions({
      sessionsRef: { current: [value] },
      setInspectedWorkerId: inspected,
      focusOpenSession: focus,
      onSelectHistorySession: open,
    });
    return null;
  }
  await act(async () => root.render(createElement(Fixture)));
  act(() => actions.onFocusOwnedApprovalSession(value.id));
  expect(focus).toHaveBeenCalledWith(value.id);
  expect(open).not.toHaveBeenCalled();
  expect(inspected).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  container.remove();
});

it("focuses an existing parent pane before inspecting its worker", async () => {
  const value = { ...request(), orchestrationLeadId: "parent" };
  const focus = vi.fn(() => true);
  const open = vi.fn(async () => {});
  const inspected = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let actions!: ReturnType<typeof useApprovalActions>;
  function Fixture() {
    actions = useApprovalActions({
      sessionsRef: { current: [value] },
      setInspectedWorkerId: inspected,
      focusOpenSession: focus,
      onSelectHistorySession: open,
    });
    return null;
  }
  await act(async () => root.render(createElement(Fixture)));
  act(() => actions.onFocusOwnedApprovalSession(value.id));
  expect(focus).toHaveBeenCalledWith("parent");
  expect(inspected).toHaveBeenCalledWith(value.id);
  expect(open).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  container.remove();
});

it.each(["advisor", "subagent"])(
  "focuses the already owned parent and opens its %s panel",
  async (kind) => {
    const parent = request();
    const child = request();
    child.modelSettings.delegationParent = JSON.stringify({
      parentSessionId: parent.id,
      runId: "run",
      kind,
      model: "m",
      startedAt: 1,
    });
    const focus = vi.fn(() => true);
    const open = vi.fn(async () => {});
    const inspected = vi.fn();
    const root = createRoot(document.createElement("div"));
    let actions!: ReturnType<typeof useApprovalActions>;
    function Fixture() {
      actions = useApprovalActions({
        sessionsRef: { current: [parent, child] },
        focusOpenSession: focus,
        onSelectHistorySession: open,
        setInspectedWorkerId: inspected,
      });
      return null;
    }
    await act(async () => root.render(createElement(Fixture)));
    act(() => actions.onFocusOwnedApprovalSession(child.id));
    expect(focus).toHaveBeenCalledWith(parent.id);
    expect(consumeViewDelegated(parent.id)).toBe(child.id);
    expect(open).not.toHaveBeenCalled();
    expect(inspected).not.toHaveBeenCalled();
    focus.mockReturnValue(false);
    act(() => actions.onFocusOwnedApprovalSession(child.id));
    expect(consumeViewDelegated(parent.id)).toBeUndefined();
    child.cwd = "G:/other";
    focus.mockClear();
    act(() => actions.onFocusOwnedApprovalSession(child.id));
    expect(focus).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  },
);
