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
    subscribe: () => () => {},
    start: async () => {},
    refresh: async () => {},
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
