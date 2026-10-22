// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { attachLogsToComposer } from "../../host-tools/logsComposer";
import { clearComposerDraft } from "../model/draftCache";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

it("adds diagnostic text to the exact existing draft without submitting and unregisters on close", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const submit = vi.fn();
  const cwd = "remote://host/project";
  clearComposerDraft("logs-session");
  try {
    await act(async () =>
      root.render(
        createElement(Composer, {
          sessionId: "logs-session",
          cwd,
          executionCwd: cwd,
          focused: false,
          harness: "codex",
          model: "",
          runtimeMode: "supervised",
          hideTopBar: true,
          initialDraft: "Please inspect this",
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit: submit,
        }),
      ),
    );
    expect(() => attachLogsToComposer("/other-project", "logs-session", "logs")).toThrow();
    expect(() => attachLogsToComposer(cwd, "other-session", "logs")).toThrow();
    await act(async () =>
      attachLogsToComposer(
        cwd,
        "logs-session",
        "UNTRUSTED RUNTIME LOG DATA\nError: failed request",
      ),
    );
    expect(container.querySelector("textarea")!.value).toBe(
      "Please inspect this\n\nUNTRUSTED RUNTIME LOG DATA\nError: failed request",
    );
    expect(submit).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    clearComposerDraft("logs-session");
    vi.unstubAllGlobals();
  }
  expect(() => attachLogsToComposer(cwd, "logs-session", "logs")).toThrow();
});
