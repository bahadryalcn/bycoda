// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { newSession } from "../model/session";
import { NotificationRequestCard } from "./NotificationRequestCard";

const decide = vi.hoisted(() => vi.fn());
vi.mock("./useApprovalDecisionControl", () => ({
  useApprovalDecisionControl: () => ({ decide, pending: false, blocked: false, feedback: null }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("shows the complete command instead of the shortened notice label and preserves actions", () => {
  const session = newSession("codex", "G:/approval-fixture");
  session.blocks = [
    {
      id: "request",
      role: "tool",
      text: "Run command",
      tool: {
        title: "Run command",
        kind: "shell",
        preview: { kind: "shell", title: "echo <exact command>" },
      },
      approval: { requestId: 42 },
    },
  ];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const focus = vi.fn();
  const dismiss = vi.fn();
  try {
    act(() =>
      root.render(
        createElement(NotificationRequestCard, {
          notice: {
            session,
            sessionId: session.id,
            requestId: 42,
            kind: "approval",
            label: "Short label",
          },
          onFocusSession: focus,
          onApproval: vi.fn(),
          onDismiss: dismiss,
        }),
      ),
    );
    expect(host.querySelector("section pre")?.textContent).toBe("echo <exact command>");
    expect(host.querySelectorAll('[data-button-variant="primary"]')).toHaveLength(1);
    const buttons = [...host.querySelectorAll("button")];
    act(() => buttons.find((button) => button.textContent === "Allow")!.click());
    expect(decide).toHaveBeenCalledWith("allow");
    act(() => buttons.find((button) => button.textContent === "Deny")!.click());
    expect(decide).toHaveBeenCalledWith("deny");
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Dismiss notice"]')!.click());
    expect(dismiss).toHaveBeenCalledOnce();
    act(() => buttons[0].click());
    expect(focus).toHaveBeenCalledWith(session.id);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
