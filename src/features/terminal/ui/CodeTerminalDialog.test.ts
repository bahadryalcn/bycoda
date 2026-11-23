// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CodeTerminalDialog } from "./CodeTerminalDialog";
import type { CodeTerminalController, CodeTerminalState } from "../runtime/codeTerminalController";

afterEach(() => localStorage.clear());

const exitedController = (): CodeTerminalController => {
  const state: CodeTerminalState = {
    id: "terminal",
    shell: "PowerShell",
    phase: "exited",
    exitCode: 0,
    output: "done",
    truncated: false,
  };
  return {
    snapshot: () => state,
    canDismiss: () => true,
    subscribe: () => () => {},
    start: async () => {},
    refresh: async () => "idle" as const,
    stop: async () => {},
  };
};
const options = {
  cwd: "/project",
  projectCwd: "/project",
  native: false,
  command: "echo done",
  shellKind: "posix" as const,
  isCurrent: () => true,
};

it("adds the finished result to chat once by default", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const report = vi.fn().mockReturnValue(true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(CodeTerminalDialog, {
          controller: exitedController(),
          options,
          onClose: () => {},
          onReport: report,
        }),
      ),
    );
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toContain("done");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("retains the result when chat admission refuses it and allows an explicit retry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("bycoda.codeRunReport", "off");
  const controller = exitedController();
  const report = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const reportButton = () =>
    Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Add result to chat",
    )!;
  try {
    await act(async () =>
      root.render(
        createElement(CodeTerminalDialog, {
          controller,
          options,
          onClose: () => {},
          onReport: report,
        }),
      ),
    );
    await act(async () => reportButton().click());
    expect(document.body.textContent).toContain("Could not add result to chat. Try again.");
    expect(document.body.textContent).not.toContain(
      "Result added to chat. Review and send when ready.",
    );
    await act(async () => reportButton().click());
    expect(document.body.textContent).toContain(
      "Result added to chat. Review and send when ready.",
    );
    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls[1][0]).toContain("done");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("holds a known undelivered command failure for grace without replay", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const state: CodeTerminalState = {
    ...exitedController().snapshot(),
    phase: "not-started",
    output: "",
    actionError: new Error("[RPC_WS_OVERLOAD] Host busy"),
  };
  const start = vi.fn(async () => {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(CodeTerminalDialog, {
          controller: { ...exitedController(), start, snapshot: () => state },
          options,
          onClose: () => {},
        }),
      ),
    );
    await act(async () => vi.advanceTimersByTimeAsync(2_999));
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("busy right now");
    expect(document.body.textContent).not.toContain("Command status unknown");
    expect(start).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
