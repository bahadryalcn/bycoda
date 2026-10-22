// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { QuickComposerShortcutEditor, KeybindingsPage } from "./ShortcutSettings";
import { saveKeybindingOverride, loadKeybindingOverrides } from "../model/settings";

vi.mock("../../../platform/tauri/platform", () => ({
  IS_MAC: true,
  IS_WIN: false,
  IS_LINUX: false,
  HAS_NATIVE_GLASS: true,
  MOD: "⌘",
  ALT: "⌥",
  SHIFT: "⇧",
  FULLSCREEN_SHORTCUT: "⌃⌘F",
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => false,
    onResized: async () => () => {},
    onFocusChanged: async () => () => {},
    isFullscreen: async () => false,
  }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true) }));

let container: HTMLDivElement;
let root: Root;
const data = new Map<string, string>();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  data.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
  vi.mocked(invoke).mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

async function render() {
  await act(async () => root.render(createElement(QuickComposerShortcutEditor)));
}

it("keeps a sibling-disabled global shortcut disabled while recording a new chord", async () => {
  await render();
  act(() => {
    data.set("bycoda.quickComposerEnabled", "0");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "bycoda.quickComposerEnabled", newValue: "0" }),
    );
  });
  const input = container.querySelector<HTMLButtonElement>(
    '[aria-label="Change Quick composer shortcut"]',
  )!;
  expect(input.textContent).toContain("Disabled");
  await act(async () => input.click());
  await act(async () =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "y",
        code: "KeyY",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(data.get("bycoda.quickComposerEnabled")).toBe("0");
  expect(data.get("bycoda.quickComposerShortcut")).toBe("Control+KeyY");
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(
        ([command, args]) =>
          command === "quick_composer_set_enabled" && (args as { enabled: boolean })?.enabled,
      ),
  ).toBe(false);
});

it("preserves an app binding when the native menu rejects a recorded shortcut", async () => {
  await act(async () => root.render(createElement(KeybindingsPage)));
  vi.mocked(invoke).mockRejectedValueOnce(new Error("Native shortcut rejected"));
  const input = container.querySelector<HTMLButtonElement>(
    '[aria-label="Change Settings: General shortcut"]',
  )!;
  await act(async () => input.click());
  await act(async () =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyQ",
        key: "q",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(invoke).toHaveBeenCalledWith("keybindings_set_overrides", {
    overrides: { "Settings: General": { shortcut: "Option+KeyQ" } },
  });
  expect(loadKeybindingOverrides()["Settings: General"]).toBeUndefined();
  expect(input.textContent).toContain("Unassigned");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Native shortcut rejected",
  );
  expect(container.querySelector('.settings-row-control [role="alert"]')).toBeNull();
  expect(container.querySelector('.settings-row-feedback [role="alert"]')).not.toBeNull();
});

it("records a global shortcut, persists it, and restores the default", async () => {
  await render();
  const input = container.querySelector<HTMLButtonElement>(
    '[aria-label="Change Quick composer shortcut"]',
  )!;
  expect(input.querySelector("[data-shortcut-display]")!.textContent).toBe("⌘⇧Space");
  await act(async () => input.click());
  expect(input.querySelector("[data-shortcut-display]")!.textContent).toBe("Record shortcut");
  await act(async () =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "MetaLeft",
        key: "Meta",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(input.querySelector("[data-shortcut-display]")!.textContent).toBe("⌘");
  await act(async () =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyQ",
        key: "q",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(invoke).toHaveBeenCalledWith("quick_composer_set_enabled", {
    enabled: true,
    shortcut: "Command+KeyQ",
  });
  expect(data.get("bycoda.quickComposerShortcut")).toBe("Command+KeyQ");
  expect(input.querySelector("[data-shortcut-display]")!.textContent).toBe("⌘Q");

  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Reset Quick composer shortcut"]')!
      .click(),
  );
  expect(data.get("bycoda.quickComposerShortcut")).toBe("Command+Shift+Space");
  expect(input.querySelector("[data-shortcut-display]")!.textContent).toBe("⌘⇧Space");
});

it("keeps the previous shortcut when native registration fails", async () => {
  await render();
  vi.mocked(invoke).mockRejectedValueOnce("Shortcut is in use");
  const input = container.querySelector<HTMLButtonElement>(
    '[aria-label="Change Quick composer shortcut"]',
  )!;
  await act(async () => input.click());
  await act(async () =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyQ",
        key: "q",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(input.querySelector("[data-shortcut-display]")!.textContent).toBe("⌘⇧Space");
  expect(data.has("bycoda.quickComposerShortcut")).toBe(false);
  expect(container.textContent).toContain("Shortcut is in use");
});

it("accepts Control plus one key", async () => {
  await render();
  const input = container.querySelector<HTMLButtonElement>(
    '[aria-label="Change Quick composer shortcut"]',
  )!;
  await act(async () => input.click());
  await act(async () =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "ControlLeft",
        key: "Control",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(input.querySelector("[data-shortcut-display]")!.textContent).toBe("⌃");
  await act(async () =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyY",
        key: "y",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(invoke).toHaveBeenCalledWith("quick_composer_set_enabled", {
    enabled: true,
    shortcut: "Control+KeyY",
  });
  expect(input.querySelector("[data-shortcut-display]")!.textContent).toBe("⌃Y");
});

it("refuses a chord another command already owns", async () => {
  await render();
  vi.mocked(invoke).mockClear();
  const input = container.querySelector<HTMLButtonElement>(
    '[aria-label="Change Quick composer shortcut"]',
  )!;
  await act(async () => input.click());
  // Command+K is App: Search's default.
  await act(async () =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyK",
        key: "k",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(container.textContent).toContain("Already used by App: Search");
  expect(data.has("bycoda.quickComposerShortcut")).toBe(false);
  // A rejected chord must never reach native registration, or the OS would
  // hold a live global hotkey that is not in settings.
  expect(invoke).not.toHaveBeenCalled();
});

it("reserves its live custom chord so no other command can claim it", async () => {
  await render();
  const input = container.querySelector<HTMLButtonElement>(
    '[aria-label="Change Quick composer shortcut"]',
  )!;
  await act(async () => input.click());
  await act(async () =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyQ",
        key: "q",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(data.get("bycoda.quickComposerShortcut")).toBe("Command+Shift+KeyQ");

  // The chord is stored outside the override table, so this is the path the
  // reviewer flagged: it must still be treated as taken.
  expect(() =>
    saveKeybindingOverride("App: Search", {
      shortcut: "Command+Shift+KeyQ",
    }),
  ).toThrow("Already used by App: Quick Composer");
});

it("re-enables and re-registers the default when a disabled row is reset", async () => {
  await render();
  const input = container.querySelector<HTMLButtonElement>(
    '[aria-label="Change Quick composer shortcut"]',
  )!;

  await act(async () => input.click());
  await act(async () =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "Backspace",
        key: "Backspace",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(input.querySelector("[data-shortcut-display]")!.textContent).toBe("Disabled");
  expect(data.get("bycoda.quickComposerEnabled")).toBe("0");

  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Reset Quick composer shortcut"]')!
      .click(),
  );
  expect(invoke).toHaveBeenCalledWith("quick_composer_set_enabled", {
    enabled: true,
    shortcut: "Command+Shift+Space",
  });
  expect(data.get("bycoda.quickComposerEnabled")).toBe("1");
  expect(input.querySelector("[data-shortcut-display]")!.textContent).toBe("⌘⇧Space");
});

it("refuses an Alt-only global shortcut without registering it", async () => {
  await render();
  vi.mocked(invoke).mockClear();
  const input = container.querySelector<HTMLButtonElement>(
    '[aria-label="Change Quick composer shortcut"]',
  )!;
  await act(async () => input.click());
  await act(async () =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyK",
        key: "k",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(container.textContent).toContain("Quick Composer needs");
  expect(invoke).not.toHaveBeenCalled();
  expect(data.has("bycoda.quickComposerShortcut")).toBe(false);
});

it("shows pressed keys without an error and Escape cancels recording", async () => {
  await render();
  const input = container.querySelector<HTMLButtonElement>(
    '[aria-label="Change Quick composer shortcut"]',
  )!;
  await act(async () => input.click());
  expect(input.querySelector("[data-shortcut-display]")!.textContent).toBe("Record shortcut");
  expect(container.textContent).toContain("Del disables · Esc cancels");
  await act(async () =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyK",
        key: "k",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(input.querySelector("[data-shortcut-display]")!.textContent).toBe("K");
  expect(container.textContent).not.toContain("Press Command");
  await act(async () =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "Escape",
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(input.querySelector("[data-shortcut-display]")!.textContent).toBe("⌘⇧Space");
  expect(container.textContent).not.toContain("Del disables · Esc cancels");
  expect(invoke).not.toHaveBeenCalledWith("quick_composer_set_enabled", expect.anything());
});
