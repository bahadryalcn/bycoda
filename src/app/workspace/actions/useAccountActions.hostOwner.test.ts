// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import { saveProviderAccount } from "../../../features/providers/model/providerAccounts";
import { RESUME_PROMPT } from "../../../features/sessions/model/inFlight";
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

it("keeps a completed local account switch ready for manual continuation after a refused send", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  saveProviderAccount({ id: "work", provider: "codex", label: "Work" });
  const session = {
    ...newSession("codex", "G:/repo"),
    usageLimit: { resetsAt: Date.now() + 60_000 },
  };
  const sessionsRef: UsageLimitAccountActionDeps["sessionsRef"] = { current: [session] };
  const onSubmit = vi.fn(() => false);
  native.switch.mockResolvedValueOnce({
    kind: "switched",
    mode: "transferred",
    update: (current: typeof session) => ({
      ...current,
      providerAccountId: "work",
      usageLimit: undefined,
    }),
  });
  let actions!: ReturnType<typeof useUsageLimitAccountActions>;
  const root = createRoot(document.createElement("div"));
  function Fixture() {
    actions = useUsageLimitAccountActions({
      active: session,
      sessionsRef,
      removingSessionIds: { current: new Set() },
      setSessions: (update) => {
        sessionsRef.current = typeof update === "function" ? update(sessionsRef.current) : update;
      },
      isMovingPane: () => false,
      enqueueHarnessEvent: vi.fn(),
      flushHarnessEvents: vi.fn(),
      promptProviderAccountSignIn: vi.fn(),
      onSubmit,
    });
    return null;
  }
  try {
    await act(async () => root.render(createElement(Fixture)));
    expect(await actions.onSwitchSessionAccount(session.id, "codex", "work")).toBe(true);
    const switched = sessionsRef.current[0];
    expect(switched.providerAccountId).toBe("work");
    expect(switched.model).toBe(session.model);
    expect(switched.usageLimit?.recoveryFrom).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();
    actions.onUsageLimitResume(session.id);
    expect(onSubmit).toHaveBeenCalledWith(session.id, RESUME_PROMPT);
    expect(sessionsRef.current[0].usageLimit).toBe(switched.usageLimit);
  } finally {
    native.switch.mockReset();
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
