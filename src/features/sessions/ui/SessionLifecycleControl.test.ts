// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useSessionLifecycleActions } from "./SessionLifecycleControl";

/** Renders the settle action the way the header renders it: a button named by its label. */
function SettleButton(props: Parameters<typeof useSessionLifecycleActions>[0]) {
  const { settle } = useSessionLifecycleActions(props);
  return settle
    ? createElement(
        "button",
        {
          "aria-label": settle.label,
          disabled: settle.disabled,
          onClick: () => void settle.onSelect?.(),
        },
        settle.label,
      )
    : null;
}

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const state = vi.hoisted(() => ({
  view: {
    sessionId: "session",
    state: "active" as "active" | "settled" | "settling",
    participants: [],
  },
  settle: vi.fn(async () => state.view),
  unsettle: vi.fn(async () => state.view),
  remoteChange: vi.fn(async () => {}),
  remoteState: undefined as "settling" | "settled" | undefined,
  remoteSupported: true,
  remoteConnected: true,
  projectLocked: false,
}));
vi.mock("../../../shared/i18n", () => ({ useT: () => (text: string) => text }));
vi.mock("../hooks/useLocalLifecycleMachine", () => ({ useLocalLifecycleMachine: () => "local" }));
vi.mock("../hooks/useSessionLifecycle", () => ({
  useSessionLifecycle: (_id: string, local: boolean) => (local ? state.view : undefined),
  useRemoteSessionLifecycleLists: () => ({
    lists: new Map([
      ["other-host", new Map([["host-session", { state: "settled" }]])],
      ...(state.remoteSupported
        ? [
            [
              "office",
              new Map(state.remoteState ? [["host-session", { state: state.remoteState }]] : []),
            ] as const,
          ]
        : []),
    ]),
    change: state.remoteChange,
  }),
}));
vi.mock("../model/sessionLifecycleClient", () => ({
  sessionLifecycleClient: () => state,
  setSessionLifecycle: vi.fn(),
}));
vi.mock("../../connections/public/connections", () => ({ remoteRequest: vi.fn() }));
vi.mock("../../connections/public/machineAvailability", () => ({
  readMachineAvailability: () => ({ available: state.remoteConnected }),
}));
vi.mock("../../group-lock/public/projectLock", () => ({
  isProjectLocked: () => state.projectLocked,
}));
vi.mock("./SessionTaskLinkDialog", () => ({ SessionTaskLinkDialog: () => null }));

it("blocks settling an empty session and enables it when a message arrives", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async (hasMessages: boolean) => {
    await act(async () =>
      root.render(
        createElement(SettleButton, {
          sessionId: "session",
          cwd: "/project",
          local: true,
          hasMessages,
        }),
      ),
    );
  };
  try {
    await render(false);
    const button = () => container.querySelector<HTMLButtonElement>('button[aria-label="Settle"]')!;
    expect(button().disabled).toBe(true);
    await act(async () => button().click());
    expect(state.settle).not.toHaveBeenCalled();
    await render(true);
    expect(button().disabled).toBe(false);
    await act(async () => button().click());
    expect(state.settle).toHaveBeenCalledExactlyOnceWith("session", false);
    for (const lifecycle of ["settled", "settling"] as const) {
      state.view.state = lifecycle;
      await render(false);
      const undo = container.querySelector<HTMLButtonElement>(
        `button[aria-label="${lifecycle === "settled" ? "Un-settle" : "Cancel settle"}"]`,
      )!;
      expect(undo.disabled).toBe(false);
      await act(async () => undo.click());
    }
    expect(state.unsettle).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it.each([
  { scenario: "settles the Host session ID", label: "Settle", undo: false },
  { scenario: "undoes a settled session", lifecycle: "settled", label: "Un-settle", undo: true },
  {
    scenario: "cancels a pending settle",
    lifecycle: "settling",
    label: "Cancel settle",
    undo: true,
  },
  { scenario: "disables settle on an empty session", hasMessages: false, label: "Settle" },
  { scenario: "hides settle when the owner lacks support", supported: false },
  { scenario: "blocks a mutation after disconnect", connected: false, label: "Settle" },
  { scenario: "blocks a mutation after a project locks", locked: true, label: "Settle" },
] as const)("remote pane $scenario", async (scenario) => {
  state.remoteChange.mockClear();
  state.remoteState = "lifecycle" in scenario ? scenario.lifecycle : undefined;
  state.remoteSupported = !("supported" in scenario);
  state.remoteConnected = !("connected" in scenario);
  state.projectLocked = "locked" in scenario;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(SettleButton, {
          sessionId: "shell-session",
          cwd: "/repo",
          local: false,
          hasMessages: !("hasMessages" in scenario),
          remoteTarget: { machineId: "office", sessionId: "host-session", projectKey: "/repo" },
        }),
      ),
    );
    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button?.getAttribute("aria-label")).toBe(
      "label" in scenario ? scenario.label : undefined,
    );
    if (button) {
      expect(button.disabled).toBe("hasMessages" in scenario);
      await act(async () => button.click());
    }
    if ("undo" in scenario)
      expect(state.remoteChange).toHaveBeenCalledExactlyOnceWith(
        "office",
        "host-session",
        scenario.undo,
        false,
        expect.any(Function),
      );
    else expect(state.remoteChange).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
