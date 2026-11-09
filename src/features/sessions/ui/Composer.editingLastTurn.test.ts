// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("../../source-control/hooks/useProjectBranches", () => ({
  useProjectBranchesState: () => ({
    branches: { current: "main", detached: false, branches: [] },
    settled: true,
  }),
}));
import { Composer } from "./Composer";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function props(extra: Partial<ComponentProps<typeof Composer>> = {}) {
  return {
    focused: false,
    harness: "codex",
    model: "m",
    runtimeMode: "supervised",
    executionCwd: "/repo",
    sessionId: "session-a",
    hideProjectPicker: true,
    hideBranchPicker: true,
    editLastTurnSupported: true,
    lastTurnRecall: { text: "earlier prompt", attachments: [] },
    onFocus: vi.fn(),
    onCwdChange: vi.fn(),
    onModelChange: vi.fn(),
    onRuntimeModeChange: vi.fn(),
    onSubmit: vi.fn(),
    ...extra,
  } as ComponentProps<typeof Composer>;
}

const editing = () => host.querySelector("[data-composer-editing]") !== null;

describe("Composer edit-last-turn marker ownership", () => {
  it("shows the owner's marker and only reports its own changes", async () => {
    const onChange = vi.fn();
    const render = (editingLastTurn: boolean) =>
      act(async () =>
        root.render(
          createElement(Composer, props({ editingLastTurn, onEditingLastTurnChange: onChange })),
        ),
      );
    await render(true);
    expect(editing()).toBe(true);
    // The owner drops the marker; the Composer follows without notifying again.
    await render(false);
    expect(editing()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("holds the marker itself without an owner and drops it with the session", async () => {
    const onChange = vi.fn();
    let recall!: () => void;
    const render = (sessionId: string) =>
      act(async () =>
        root.render(
          createElement(
            Composer,
            props({
              sessionId,
              onEditingLastTurnChange: onChange,
              onRecallLastTurnReady: (fn) => {
                recall = fn;
              },
            }),
          ),
        ),
      );
    await render("session-a");
    await act(async () => recall());
    expect(editing()).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(true);
    await render("session-b");
    expect(editing()).toBe(false);
  });
});
