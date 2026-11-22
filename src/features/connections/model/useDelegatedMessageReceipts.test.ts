// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  DELEGATION_MESSAGES_STREAM,
  type DelegationMessage,
} from "../../../shared/model/host-contracts/delegation";
import { useDelegatedMessageReceipts } from "./useDelegatedMessageReceipts";

const mocks = vi.hoisted(() => ({
  capabilities: vi.fn(),
  retain: vi.fn(),
  release: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock("./connections", () => ({
  cachedRemoteCapabilities: mocks.capabilities,
  savedMachineForEnvironment: () => ({ id: "machine" }),
  subscribeRemoteCapabilities: () => () => {},
  subscribeRemoteMachineList: () => () => {},
  useRemoteMachineOnline: () => true,
}));
vi.mock("./remoteMachineChannel", () => ({
  acquireRemoteHostRuntime: () => ({
    runtime: { retain: mocks.retain.mockReturnValue(mocks.unsubscribe) },
    release: mocks.release,
  }),
}));

afterEach(() => vi.unstubAllGlobals());

it("retains one supported child and ignores late updates after changing selection", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.capabilities.mockReturnValue([DELEGATION_MESSAGES_STREAM]);
  const root = createRoot(document.createElement("div"));
  let rows: readonly DelegationMessage[] = [];
  function Probe({ id }: { id?: string }) {
    rows = useDelegatedMessageReceipts("environment", id);
    return null;
  }
  try {
    act(() => root.render(createElement(Probe, { id: "child-1" })));
    const [target, first] = mocks.retain.mock.calls[0];
    expect(target).toEqual({ kind: "delegationMessages", sessionId: "child-1" });
    const queued = first.parse([
      {
        id: "message",
        text: "Later",
        sender: "parent",
        mode: "queue",
        delivery: "queued",
        createdAt: 1,
      },
    ]);
    act(() => first.commit(queued, { isCurrent: () => true }));
    expect(rows).toEqual(queued);

    act(() => root.render(createElement(Probe, { id: "child-2" })));
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.release).toHaveBeenCalledTimes(1);
    act(() => first.commit(queued, { isCurrent: () => true }));
    expect(rows).toEqual([]);

    const second = mocks.retain.mock.calls[1][1];
    act(() => second.commit(queued, { isCurrent: () => false }));
    expect(rows).toEqual([]);
    act(() => second.commit(queued, { isCurrent: () => true }));
    act(() => second.closed());
    expect(rows).toEqual([]);

    act(() => root.render(createElement(Probe)));
    expect(mocks.retain).toHaveBeenCalledTimes(2);
  } finally {
    act(() => root.unmount());
  }
});
