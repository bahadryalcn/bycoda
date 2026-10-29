// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuickModelSelector } from "./QuickModelSelector";
import {
  resetHarnessModelOverlays,
  setHarnessModels,
  type AgentModel,
} from "../../sessions/model/models";
import type { HarnessId } from "../../sessions/model/session";

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

const alpha: AgentModel = { id: "cat-claude-alpha", name: "Cat Alpha", harness: "claude" };
const beta: AgentModel = { id: "cat-claude-beta", name: "Cat Beta", harness: "claude" };
const gamma: AgentModel = { id: "cat-claude-gamma", name: "Cat Gamma", harness: "claude" };
const grokOne: AgentModel = { id: "cat-grok-one", name: "Cat Grok One", harness: "grok" };
const grokTwo: AgentModel = { id: "cat-grok-two", name: "Cat Grok Two", harness: "grok" };

let container: HTMLDivElement;
let root: Root;
const onChange = vi.fn();
const onSettingsChange = vi.fn();
const onClose = vi.fn();

function render(availableHarnesses: HarnessId[] | null = ["claude", "grok"]) {
  act(() =>
    root.render(
      createElement(QuickModelSelector, {
        model: alpha,
        values: {},
        availableHarnesses,
        onChange,
        onSettingsChange,
        onClose,
      }),
    ),
  );
}

function search() {
  return container.querySelector<HTMLInputElement>('input[aria-label="Search models"]')!;
}

function key(name: string) {
  act(() =>
    search().dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    ),
  );
}

function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(search(), value);
    search().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Display name of the row the combobox currently points at. */
function highlighted() {
  const id = search().getAttribute("aria-activedescendant");
  return id ? container.querySelector(`[id="${id}"]`)?.textContent : undefined;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  resetHarnessModelOverlays();
  setHarnessModels("claude", [alpha, beta, gamma]);
  setHarnessModels("grok", [grokOne]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  render();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetHarnessModelOverlays();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("starts on the selected model and ArrowDown moves to the next available one", () => {
  expect(highlighted()).toContain("Cat Alpha");
  key("ArrowDown");
  expect(highlighted()).toContain("Cat Beta");
});

it("keeps the arrowed model when an unrelated provider catalog changes", () => {
  key("ArrowDown");
  act(() => setHarnessModels("grok", [grokTwo, grokOne]));
  expect(highlighted()).toContain("Cat Beta");
  key("Enter");
  expect(onChange).toHaveBeenCalledOnce();
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ id: beta.id, harness: "claude" }),
  );
});

it("follows the arrowed model identity when the same provider catalog is reordered", () => {
  key("ArrowDown");
  act(() => setHarnessModels("claude", [gamma, beta, alpha]));
  expect(highlighted()).toContain("Cat Beta");
  key("Enter");
  expect(onChange).toHaveBeenCalledOnce();
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ id: beta.id, harness: "claude" }),
  );
});

it("keeps the arrowed model when the catalog grows ahead of it", () => {
  key("ArrowDown");
  const extra: AgentModel = { id: "cat-claude-extra", name: "Cat Extra", harness: "claude" };
  act(() => setHarnessModels("claude", [extra, alpha, beta, gamma]));
  key("Enter");
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: beta.id }));
});

it("falls back to the selected model when the arrowed model leaves the catalog", () => {
  key("ArrowDown");
  act(() => setHarnessModels("claude", [alpha, gamma]));
  expect(highlighted()).toContain("Cat Alpha");
  key("Enter");
  expect(onChange).toHaveBeenCalledOnce();
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: alpha.id }));
});

it("falls back to the first eligible model when neither arrowed nor selected model remains", () => {
  key("ArrowDown");
  act(() => setHarnessModels("claude", [gamma]));
  expect(highlighted()).toContain("Cat Gamma");
  key("Enter");
  expect(onChange).toHaveBeenCalledOnce();
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: gamma.id }));
});

it("never selects a model whose provider is unavailable", () => {
  key("ArrowDown");
  render(null);
  const options = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  expect(options.length).toBeGreaterThan(0);
  expect(options.every((option) => option.disabled)).toBe(true);
  expect(search().getAttribute("aria-activedescendant")).toBeNull();
  key("ArrowDown");
  key("Enter");
  expect(onChange).not.toHaveBeenCalled();
});

it("resets the highlight when the query changes", () => {
  key("ArrowDown");
  expect(highlighted()).toContain("Cat Beta");
  type("Cat");
  expect(highlighted()).toContain("Cat Alpha");
  key("Enter");
  expect(onChange).toHaveBeenCalledOnce();
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: alpha.id }));
});
