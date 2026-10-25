// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { QuickComposer } from "./QuickComposer";

const native = vi.hoisted(() => ({
  shown: () => {},
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(async (name, callback) => {
    if (name === "quick_composer_shown") native.shown = callback;
    return () => {};
  }),
}));
vi.mock("./useQuickPickerMotion", () => ({ useQuickPickerMotion: () => {} }));
vi.mock("./QuickWorkspaceControls", () => ({
  QuickWorkspaceControls: () => null,
}));
vi.mock("./QuickProjectIcon", () => ({
  QuickProjectIcon: () => null,
  loadQuickProjectAppearance: () => ({}),
}));
vi.mock("./QuickModelSelector", () => ({ QuickModelSelector: () => null }));
vi.mock("./useQuickAttachments", () => ({
  useQuickAttachments: () => ({ files: [], clear: () => {} }),
}));
vi.mock("../model/quickComposer", async (actual) => ({
  ...(await actual<object>()),
  loadQuickProjects: () => ["/tmp/project"],
  initialQuickChoice: () => ({ harness: "codex", model: "test" }),
  resolveQuickModel: () => ({
    harness: "codex",
    id: "test",
    name: "Test model",
  }),
}));

let root: Root;
let container: HTMLDivElement;
let prompt: HTMLTextAreaElement;

function commands() {
  return container.querySelector('[role="listbox"][aria-label="Commands"]');
}

function input(text: string, cursor = text.length) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      prompt,
      text,
    );
    prompt.setSelectionRange(cursor, cursor);
    prompt.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(key: string, options: KeyboardEventInit = {}) {
  await act(async () => {
    prompt.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...options,
      }),
    );
  });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    callback();
    return 0;
  });
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(QuickComposer, { onShown: () => {} })));
  prompt = container.querySelector("textarea")!;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("shows launch progress once and preserves a newer draft after completion", async () => {
  let finish!: () => void;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "quick_composer_submit")
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
  });
  input("First request");
  const start = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Start",
  )!;
  start.focus();
  act(() => {
    start.click();
    start.click();
  });
  await act(async () => {});
  expect(
    vi.mocked(invoke).mock.calls.filter(([command]) => command === "quick_composer_submit"),
  ).toHaveLength(1);
  expect(start.getAttribute("aria-busy")).toBe("true");
  expect(document.activeElement).toBe(start);
  input("Next draft while the first request finishes");
  await act(async () => finish());
  expect(prompt.value).toBe("Next draft while the first request finishes");
  expect(start.getAttribute("aria-busy")).not.toBe("true");
});

it("keeps a failed launch draft and exposes the complete error for recovery", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "quick_composer_submit")
      throw new Error("Reconnect the owning computer before retrying this unchanged draft.");
  });
  input("Keep this request");
  await key("Enter");
  expect(prompt.value).toBe("Keep this request");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Reconnect the owning computer before retrying this unchanged draft.",
  );
});

it.each(["Enter", "Tab"])(
  "offers /operator and completes it with %s before submitting the prompt",
  async (completionKey) => {
    input("/");
    expect(commands()?.textContent).toContain("Operator");
    input("/op");
    await key("ArrowDown");
    await key("ArrowUp");
    expect(commands()?.querySelector('[aria-selected="true"]')?.textContent).toContain("Operator");
    await key(completionKey);
    expect(prompt.value).toBe("/operator ");
    expect(prompt.selectionStart).toBe(prompt.value.length);
    expect(commands()).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("quick_composer_submit", expect.anything());

    input("/operator list my notes");
    await key("Enter");
    expect(invoke).toHaveBeenCalledWith("quick_composer_submit", {
      request: expect.objectContaining({
        prompt: "/operator list my notes",
        reveal: false,
      }),
    });
    expect(prompt.value).toBe("");
  },
);

it("completes a command by mouse while preserving the rest of the prompt and caret", async () => {
  input("  /op list my notes", 5);
  await act(async () => commands()!.querySelector<HTMLButtonElement>('[role="option"]')!.click());
  expect(prompt.value).toBe("  /operator list my notes");
  expect(prompt.selectionStart).toBe("  /operator ".length);
  expect(prompt.selectionEnd).toBe(prompt.selectionStart);
  expect(document.activeElement).toBe(prompt);
  expect(commands()).toBeNull();
});

it("closes command suggestions with Escape before dismissing the composer", async () => {
  input("/op");
  await key("Escape");
  expect(commands()).toBeNull();
  expect(prompt.value).toBe("/op");
  expect(invoke).not.toHaveBeenCalledWith("quick_composer_dismiss");
  await key("Escape");
  expect(invoke).toHaveBeenCalledWith("quick_composer_dismiss");
});

it("does not suggest Operator inside normal text or paths and filters unknown commands", () => {
  for (const text of ["Explain /op", "/tmp/project", "https://example.com", "> /op"]) {
    input(text);
    expect(commands()).toBeNull();
  }
  input("/unknown");
  expect(commands()?.textContent).toContain("No matching commands");
  expect(commands()?.querySelector('[role="option"]')).toBeNull();
});

it("preserves typed /operator for start-and-open and retains it after a failed launch", async () => {
  input("/operator list my notes");
  vi.mocked(invoke).mockRejectedValueOnce(new Error("Could not start session"));
  await key("Enter", { metaKey: true });
  expect(invoke).toHaveBeenCalledWith("quick_composer_submit", {
    request: expect.objectContaining({
      prompt: "/operator list my notes",
      reveal: true,
    }),
  });
  expect(prompt.value).toBe("/operator list my notes");
  expect(container.textContent).toContain("Could not start session");
  await act(async () => native.shown());
  expect(prompt.value).toBe("/operator list my notes");
  await key("Enter", { metaKey: true });
  expect(prompt.value).toBe("");
});

it("does not consume command selection keys during IME composition", async () => {
  input("/op");
  await key("Enter", { isComposing: true });
  expect(prompt.value).toBe("/op");
  expect(commands()).not.toBeNull();
  expect(invoke).not.toHaveBeenCalledWith("quick_composer_submit", expect.anything());
});

function modePill() {
  return container.querySelector('[aria-label^="Turn off"]');
}

it("lists every mode command and launches each in its mode", async () => {
  input("/");
  const listed = commands()!.textContent;
  for (const name of ["Plan", "Operator", "Orchestrator", "Draft"]) expect(listed).toContain(name);

  input("/orch");
  await key("Enter");
  expect(prompt.value).toBe("/orchestrator ");
  // The command shows in the prompt only; the floating UI has no mode pill.
  expect(modePill()).toBeNull();
  input("/orchestrator ship it");
  await key("Enter");
  expect(invoke).toHaveBeenLastCalledWith("quick_composer_submit", {
    request: expect.objectContaining({
      prompt: "ship it",
      intent: "orchestrate",
    }),
  });

  input("/draft remember this");
  expect(container.textContent).toContain("Save draft");
  await key("Enter");
  expect(invoke).toHaveBeenLastCalledWith("quick_composer_submit", {
    request: expect.objectContaining({ prompt: "remember this", draft: true }),
  });
});

it("keeps /plan in the prompt and sends the plan intent", async () => {
  input("/pla");
  await key("Enter");
  expect(prompt.value).toBe("/plan ");
  input("/plan sketch the refactor");
  await key("Enter");
  expect(invoke).toHaveBeenLastCalledWith("quick_composer_submit", {
    request: expect.objectContaining({
      prompt: "sketch the refactor",
      intent: "plan",
    }),
  });
});
