// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SessionLifecycleControl } from "./SessionLifecycleControl";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const state = vi.hoisted(() => ({
  view: {
    sessionId: "session",
    state: "active" as "active" | "settled" | "settling",
    participants: [],
  },
  settle: vi.fn(async () => state.view),
  unsettle: vi.fn(async () => state.view),
}));
vi.mock("../../../shared/i18n", () => ({ useT: () => (text: string) => text }));
vi.mock("../hooks/useLocalLifecycleMachine", () => ({ useLocalLifecycleMachine: () => "local" }));
vi.mock("../hooks/useSessionLifecycle", () => ({ useSessionLifecycle: () => state.view }));
vi.mock("../model/sessionLifecycleClient", () => ({
  sessionLifecycleClient: () => state,
  setSessionLifecycle: vi.fn(),
}));
vi.mock("../../connections/public/connections", () => ({ remoteRequest: vi.fn() }));
vi.mock("./SessionTaskLinkDialog", () => ({ SessionTaskLinkDialog: () => null }));

it("blocks settling an empty session and enables it when a message arrives", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async (hasMessages: boolean) => {
    await act(async () =>
      root.render(
        createElement(SessionLifecycleControl, {
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
    expect(state.settle).toHaveBeenCalledExactlyOnceWith("session");
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
