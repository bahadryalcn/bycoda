// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CodeExecutionProvider, CodeRunButton } from "./CodeExecutionContext";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  start: vi.fn(),
  dialog: vi.fn(() => null),
  toast: vi.fn(),
}));
vi.mock("../../terminal/public/codeExecution", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createCodeTerminal: mocks.create,
  CodeTerminalDialog: mocks.dialog,
}));
vi.mock("../../../shared/ui/ToastRegion", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { show: mocks.toast },
}));
afterEach(() => vi.clearAllMocks());

it("hides execution outside session scope and on non-shell fences", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(CodeRunButton, { code: "echo hi", language: "bash", incomplete: false }),
      ),
    );
    expect(container.querySelector("button")).toBeNull();
    await act(async () =>
      root.render(
        createElement(CodeExecutionProvider, {
          scope: { sessionId: "s", projectCwd: "/project", native: true },
          cwd: "/project",
          children: createElement(CodeRunButton, {
            code: "print('hi')",
            language: "python",
            incomplete: false,
          }),
        }),
      ),
    );
    expect(container.querySelector("button")).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});

it("blocks partial source and executes complete source once despite double click", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.start.mockResolvedValue(undefined);
  mocks.create.mockReturnValue({ start: mocks.start });
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = (incomplete: boolean) =>
    createElement(CodeExecutionProvider, {
      scope: { sessionId: "s", projectCwd: "/project", native: true },
      cwd: "/project/tree",
      children: createElement(CodeRunButton, { code: "echo hi\n", language: "bash", incomplete }),
    });
  try {
    await act(async () => root.render(render(true)));
    expect(container.querySelector("button")?.disabled).toBe(true);
    await act(async () => root.render(render(false)));
    await act(async () => {
      container.querySelector("button")!.click();
      container.querySelector("button")!.click();
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      command: "echo hi",
      shellKind: "posix",
      cwd: "/project/tree",
    });
    expect(mocks.start).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
  }
});

it("opens a native run in the project dock and reports its settled output once", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const listeners = new Set<() => void>();
  let state = { id: "run-1", phase: "starting", shell: "bash", profile: "bash", output: "" };
  const controller = {
    start: vi.fn(async () => {
      state = { ...state, phase: "running" };
    }),
    snapshot: () => ({ ...state, truncated: false, exitCode: 0 }),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  mocks.create.mockReturnValue(controller);
  const openTerminal = vi.fn().mockReturnValue(true);
  const report = vi.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(CodeExecutionProvider, {
          scope: { sessionId: "s", projectCwd: "/project", native: true, openTerminal },
          cwd: "/project",
          onReport: report,
          children: createElement(CodeRunButton, {
            code: "echo hi",
            language: "bash",
            incomplete: false,
          }),
        }),
      ),
    );
    await act(async () => container.querySelector("button")!.click());
    expect(openTerminal).toHaveBeenCalledWith("s", "/project", "bash", "run-1");
    state = { ...state, phase: "exited", output: "hi" };
    for (const listener of listeners) listener();
    for (const listener of listeners) listener();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toContain("hi");
  } finally {
    await act(async () => root.unmount());
  }
});

it("keeps a deferred native startup failure in the fallback dialog without a toast", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const controller = {
    start: vi.fn(async () => {}),
    snapshot: () => ({
      phase: "unknown",
      actionError: new Error("[RPC_TIMEOUT] Terminal profiles timed out."),
    }),
  };
  mocks.create.mockReturnValue(controller);
  const openTerminal = vi.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(CodeExecutionProvider, {
          scope: { sessionId: "s", projectCwd: "/project", native: true, openTerminal },
          cwd: "/project",
          children: createElement(CodeRunButton, {
            code: "echo hi",
            language: "bash",
            incomplete: false,
          }),
        }),
      ),
    );
    await act(async () => container.querySelector("button")!.click());
    expect(mocks.dialog).toHaveBeenCalledOnce();
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(openTerminal).not.toHaveBeenCalled();
    expect(controller.start).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
