// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import { registerRemoteSessionActions } from "../../../features/connections/model/remoteSessionActions";
import { useUsageLimitAccountActions, type UsageLimitAccountActionDeps } from "./useAccountActions";

const native = vi.hoisted(() => ({ switch: vi.fn() }));
vi.mock("../../../features/sessions/model/accountSwitch", async (original) => ({
  ...(await original<typeof import("../../../features/sessions/model/accountSwitch")>()),
  switchSessionAccount: native.switch,
}));

it("routes account changes for an explicit local Host session before any Native account transfer work", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const session = newSession("codex", "G:/repo");
  session.hostBinding = {
    kind: "local-host",
    machineId: "local",
    environmentId: "home",
    projectId: "project",
    sessionId: session.id,
    authorityGeneration: null,
    created: true,
  };
  const select = vi.fn(() => true);
  const detach = registerRemoteSessionActions(session.id, { selectAccount: select } as never);
  let actions!: ReturnType<typeof useUsageLimitAccountActions>;
  const root = createRoot(document.createElement("div"));
  function Fixture() {
    actions = useUsageLimitAccountActions({
      sessionsRef: { current: [session] },
      enqueueHarnessEvent: vi.fn(),
      flushHarnessEvents: vi.fn(),
    } as unknown as UsageLimitAccountActionDeps);
    return null;
  }
  try {
    await act(async () => root.render(createElement(Fixture)));
    expect(await actions.onSwitchSessionAccount(session.id, "codex", "host-profile")).toBe(true);
    expect(select).toHaveBeenCalledWith("codex", "host-profile");
    detach();
    expect(await actions.onSwitchSessionAccount(session.id, "codex", "host-profile")).toBe(false);
    expect(native.switch).not.toHaveBeenCalled();
  } finally {
    detach();
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
