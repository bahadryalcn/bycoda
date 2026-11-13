// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SessionPanelTargetsContext } from "./SessionPanelTargets";
import { SessionPane, type SessionPaneProps } from "./SessionPane";

it("uses a host target instead of mounting a second local or remote conversation from history", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const release = vi.fn();
  const register = vi.fn(() => release);
  try {
    await act(async () =>
      root.render(
        createElement(
          SessionPanelTargetsContext.Provider,
          { value: { sessionIds: ["social"], register } },
          createElement(SessionPane, {
            session: { id: "social", cwd: "remote://host/project" },
            visible: true,
            focused: true,
            inSplit: false,
          } as SessionPaneProps),
        ),
      ),
    );
    expect(register).toHaveBeenCalledWith({
      sessionId: "social",
      host: node.querySelector("div"),
      visible: true,
      focused: true,
      inSplit: false,
    });
    expect(node.querySelector("textarea")).toBeNull();
    await act(async () => root.unmount());
    expect(release).toHaveBeenCalledOnce();
  } finally {
    node.remove();
    vi.unstubAllGlobals();
  }
});
