// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CodeExecutionProvider, CodeRunButton } from "./CodeExecutionContext";

const mocks = vi.hoisted(() => ({ create: vi.fn(), start: vi.fn() }));
vi.mock("../../terminal/public/codeExecution", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createCodeTerminal: mocks.create,
  CodeTerminalDialog: () => null,
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
