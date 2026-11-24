// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { clearComposerDraft } from "../model/draftCache";
import { resetHarnessModelOverlays, setHarnessModels } from "../model/models";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []), isTauri: () => false }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clearComposerDraft("extras-session");
  setHarnessModels("codex", [
    {
      id: "codex:test",
      harness: "codex",
      name: "Test",
      settings: [
        {
          id: "reasoningEffort",
          label: "Reasoning",
          kind: "select",
          value: "high",
          options: [
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
          ],
        },
        {
          id: "fast",
          label: "Fast",
          kind: "toggle",
          value: "false",
          options: [
            { value: "true", label: "On" },
            { value: "false", label: "Off" },
          ],
        },
      ],
    },
  ]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.removeItem("bycoda.modelControls");
  resetHarnessModelOverlays();
  vi.unstubAllGlobals();
});

async function labelsWith(mode: "menu" | "beside") {
  localStorage.setItem("bycoda.modelControls", mode);
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(Composer, {
        sessionId: "extras-session",
        cwd: "/project",
        executionCwd: "/project",
        focused: false,
        harness: "codex",
        model: "codex:test",
        modelSettings: { reasoningEffort: "high" },
        runtimeMode: "supervised",
        hideTopBar: true,
        onFocus: vi.fn(),
        onCwdChange: vi.fn(),
        onModelChange: vi.fn(),
        onModelSettingsChange: vi.fn(),
        onRuntimeModeChange: vi.fn(),
        onSubmit: vi.fn(),
      }),
    ),
  );
  return [...container.querySelectorAll("[data-composer-model-controls] button")].map(
    (button) => button.getAttribute("aria-label") ?? button.textContent ?? "",
  );
}

it("shows active options beside the picker only when Extras summary asks for it", async () => {
  const menu = await labelsWith("menu");
  const beside = await labelsWith("beside");

  expect(menu.some((label) => /^fast/i.test(label))).toBe(false);
  expect(beside.some((label) => /^fast/i.test(label))).toBe(true);
  // The picker already shows the current effort, so no second effort control appears.
  expect(beside.some((label) => label.startsWith("Reasoning:"))).toBe(false);
});
