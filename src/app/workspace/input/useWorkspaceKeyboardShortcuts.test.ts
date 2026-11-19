// @vitest-environment happy-dom
import { act, createElement, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  useWorkspaceKeyboardShortcuts,
  type WorkspaceKeyboardShortcutDeps,
} from "./useWorkspaceKeyboardShortcuts";
import type { WorkspaceActions } from "./useWorkspaceActions";
import { LAYOUT_SHORTCUTS } from "../../../features/settings/model/appShortcuts";
import { saveKeybindingOverride } from "../../../features/settings/model/settings";
import { Modal } from "../../../shared/ui/Modal";

const editorFind = vi.hoisted(() => vi.fn(() => false));
vi.mock("../../../features/files/editor/editorFindBridge", () => ({
  handleEditorFindKey: editorFind,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
const fullscreen = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../../../platform/tauri/fullscreen", () => ({ setNativeFullscreen: fullscreen }));

let root: Root;
let container: HTMLDivElement;
let deps: WorkspaceKeyboardShortcutDeps;
const ref = <T>(current: T): MutableRefObject<T> => ({ current });

function Listener() {
  useWorkspaceKeyboardShortcuts(deps);
  return null;
}
function press(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

it("lets terminal find and command assistance receive their shortcuts before the editor", () => {
  const terminal = document.createElement("div");
  terminal.className = "bycoda-terminal";
  const input = document.createElement("textarea");
  terminal.append(input);
  container.append(terminal);
  editorFind.mockClear();
  for (const init of [
    { key: "f", ctrlKey: true },
    { key: "f", metaKey: true },
    { key: " ", ctrlKey: true },
  ]) {
    const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  expect(editorFind).not.toHaveBeenCalled();
  terminal.dataset.terminalTools = "";
  deps.nativeFullscreenRef.current = true;
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  input.dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(false);
});

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  fullscreen.mockClear();
  deps = {
    actions: ref({
      onArrangeActiveTab: vi.fn(),
      onOpenInbox: vi.fn(),
      onOpenNotes: vi.fn(),
      onOpenTasks: vi.fn(),
      onOpenAutomations: vi.fn(),
      openSettings: vi.fn(),
      onNew: vi.fn(),
      onGoToFile: vi.fn(),
      onOpenCommandPalette: vi.fn(),
      onToggleNotesPanel: vi.fn(),
    } as unknown as WorkspaceActions),
    run: (_name, action) => action(),
    nativeFullscreenRef: ref(false),
    searchViewOpenRef: ref(false),
    settingsOpenRef: ref(false),
    inboxViewOpenRef: ref(false),
    notesViewOpenRef: ref(false),
    automationsViewOpenRef: ref(false),
    serversViewOpenRef: ref(false),
    filePickerOpenRef: ref(false),
    whatsNewVersionRef: ref(null),
    onToggleMaximizePane: vi.fn(),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Listener)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each(["ctrlKey", "metaKey"] as const)(
  "consumes repeated picker shortcuts with %s while its Modal owns focus",
  async (modifier) => {
    expect(press({ key: "p", code: "KeyP", [modifier]: true }).defaultPrevented).toBe(true);
    expect(deps.actions.current.onGoToFile).toHaveBeenCalledOnce();
    deps.filePickerOpenRef.current = true;
    await act(async () =>
      root.render(
        createElement(
          "div",
          null,
          createElement(Listener),
          createElement(Modal, {
            title: "Go to File",
            onClose: vi.fn(),
            children: createElement("input", { "aria-label": "File query", defaultValue: "draft" }),
          }),
        ),
      ),
    );
    const input = document.querySelector<HTMLInputElement>('input[aria-label="File query"]')!;
    input.focus();
    for (const init of [
      { key: "p", code: "KeyP", [modifier]: true },
      { key: "p", code: "KeyP", [modifier]: true, repeat: true },
      { key: "p", code: "KeyP", [modifier]: true, shiftKey: true },
    ]) {
      const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(deps.actions.current.onGoToFile).toHaveBeenCalledOnce();
    expect(deps.actions.current.onOpenCommandPalette).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("draft");
    saveKeybindingOverride("App: Go to File", { shortcut: "Option+KeyQ" });
    expect(press({ key: "q", code: "KeyQ", altKey: true }).defaultPrevented).toBe(true);
    expect(press({ key: "p", code: "KeyP", [modifier]: true }).defaultPrevented).toBe(false);
    saveKeybindingOverride("App: Go to File", { disabled: true });
    expect(press({ key: "q", code: "KeyQ", altKey: true }).defaultPrevented).toBe(false);
  },
);

function pressInTerminal(init: KeyboardEventInit) {
  const terminal = document.createElement("div");
  terminal.className = "bycoda-terminal";
  const input = document.createElement("textarea");
  terminal.append(input);
  container.append(terminal);
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  input.dispatchEvent(event);
  terminal.remove();
  return event;
}

it.each(["w", "d", "t", "n", "b", "p", "o", "j", "k"])(
  "leaves plain Ctrl+%s to the focused terminal instead of the app chord",
  (letter) => {
    const actions = deps.actions.current as unknown as Record<string, ReturnType<typeof vi.fn>>;
    for (const name of [
      "onClosePane",
      "onSplit",
      "onNewTerminalTab",
      "onToggleSidebar",
      "onToggleProjectTerminal",
      "pickProject",
      "onOpenSearch",
    ])
      actions[name] = vi.fn();
    const event = pressInTerminal({
      key: letter,
      code: `Key${letter.toUpperCase()}`,
      ctrlKey: true,
    });
    expect(event.defaultPrevented).toBe(false);
    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
  },
);

it("keeps app and emergency chords reachable from a terminal", () => {
  const actions = deps.actions.current as unknown as Record<string, ReturnType<typeof vi.fn>>;
  actions.onNext = vi.fn();
  expect(pressInTerminal({ key: "Tab", code: "Tab", ctrlKey: true }).defaultPrevented).toBe(true);
  expect(actions.onNext).toHaveBeenCalledOnce();
  expect(
    pressInTerminal({ key: "P", code: "KeyP", ctrlKey: true, shiftKey: true }).defaultPrevented,
  ).toBe(true);
  expect(actions.onOpenCommandPalette).toHaveBeenCalledOnce();
  deps.nativeFullscreenRef.current = true;
  expect(pressInTerminal({ key: "Escape", code: "Escape" }).defaultPrevented).toBe(true);
  expect(fullscreen).toHaveBeenCalledWith(false);
  // Outside a terminal the same plain chord keeps its app meaning.
  expect(press({ key: "p", code: "KeyP", ctrlKey: true }).defaultPrevented).toBe(true);
  expect(actions.onGoToFile).toHaveBeenCalledOnce();
});

it("still honours a Ctrl+letter chord the owner recorded for an app command from a terminal", () => {
  saveKeybindingOverride("App: Go to File", { shortcut: "Control+KeyG" });
  const event = pressInTerminal({ key: "g", code: "KeyG", ctrlKey: true });
  expect(event.defaultPrevented).toBe(true);
  expect(deps.actions.current.onGoToFile).toHaveBeenCalledOnce();
});

it("opens a directly assigned settings section and respects a disabled binding", () => {
  saveKeybindingOverride("Settings: Connections", { shortcut: "Option+KeyQ" });
  const event = press({ key: "q", code: "KeyQ", altKey: true });
  expect(event.defaultPrevented).toBe(true);
  expect(deps.actions.current.openSettings).toHaveBeenCalledExactlyOnceWith("connections");
  saveKeybindingOverride("Settings: Connections", { disabled: true });
  expect(press({ key: "q", code: "KeyQ", altKey: true }).defaultPrevented).toBe(false);
  expect(deps.actions.current.openSettings).toHaveBeenCalledTimes(1);
});

it("leaves legacy IME key events untouched for default and custom workspace chords", () => {
  editorFind.mockClear();
  const defaultEvent = press({
    key: "i",
    code: "KeyI",
    ctrlKey: true,
    shiftKey: true,
    keyCode: 229,
  });
  expect(defaultEvent.defaultPrevented).toBe(false);
  saveKeybindingOverride("App: Open Inbox", { shortcut: "Option+KeyQ" });
  const customEvent = press({ key: "q", code: "KeyQ", altKey: true, keyCode: 229 });
  expect(customEvent.defaultPrevented).toBe(false);
  expect(deps.actions.current.onOpenInbox).not.toHaveBeenCalled();
  expect(editorFind).not.toHaveBeenCalled();
});

it("opens a session on Ctrl+N and routes Ctrl+Alt+N to notes", () => {
  expect(press({ key: "n", code: "KeyN", ctrlKey: true }).defaultPrevented).toBe(true);
  expect(deps.actions.current.onNew).toHaveBeenCalledOnce();
  expect(deps.actions.current.onToggleNotesPanel).not.toHaveBeenCalled();
  press({ key: "n", code: "KeyN", ctrlKey: true, altKey: true });
  expect(deps.actions.current.onToggleNotesPanel).toHaveBeenCalledOnce();
  press({ key: "n", code: "KeyN", ctrlKey: true, repeat: true });
  expect(deps.actions.current.onNew).toHaveBeenCalledOnce();
});

it.each([
  ["onNew", { key: "t", code: "KeyT", ctrlKey: true }],
  ["onClosePane", { key: "w", code: "KeyW", ctrlKey: true }],
  ["onCloseAllTabs", { key: "W", code: "KeyW", ctrlKey: true, shiftKey: true }],
  ["onCloseOtherTabs", { key: "t", code: "KeyT", ctrlKey: true, altKey: true }],
  ["onSplit", { key: "d", code: "KeyD", ctrlKey: true }],
  ["onNewTerminal", { key: "`", code: "Backquote", ctrlKey: true }],
  ["onToggleProjectTerminal", { key: "j", code: "KeyJ", ctrlKey: true }],
  ["onActivate", { key: "2", code: "Digit2", ctrlKey: true }],
  ["onToggleSidebar", { key: "b", code: "KeyB", ctrlKey: true }],
] as const)("runs %s once per press and ignores a held key", (handler, init) => {
  const actions = deps.actions.current as unknown as Record<string, ReturnType<typeof vi.fn>>;
  actions[handler] = vi.fn();
  expect(press(init).defaultPrevented).toBe(true);
  expect(actions[handler]).toHaveBeenCalledOnce();
  // Auto-repeat keeps the browser/native default suppressed but never re-runs it.
  for (let i = 0; i < 5; i++) expect(press({ ...init, repeat: true }).defaultPrevented).toBe(true);
  expect(actions[handler]).toHaveBeenCalledOnce();
});

it("ignores a held key for a recorded one-shot tab binding but still repeats navigation", () => {
  const actions = deps.actions.current as unknown as Record<string, ReturnType<typeof vi.fn>>;
  actions.onClosePane = vi.fn();
  actions.onNext = vi.fn();
  actions.onFocusDir = vi.fn();
  saveKeybindingOverride("Pane: Close", { shortcut: "Option+KeyQ" });
  press({ key: "q", code: "KeyQ", altKey: true });
  press({ key: "q", code: "KeyQ", altKey: true, repeat: true });
  expect(actions.onClosePane).toHaveBeenCalledOnce();
  for (let i = 0; i < 3; i++) {
    press({ key: "Tab", code: "Tab", ctrlKey: true, repeat: i > 0 });
    press({ key: "ArrowLeft", code: "ArrowLeft", ctrlKey: true, altKey: true, repeat: i > 0 });
  }
  expect(actions.onNext).toHaveBeenCalledTimes(3);
  expect(actions.onFocusDir).toHaveBeenCalledTimes(3);
});

it("opens an app surface once per press", () => {
  const chord = { key: "i", code: "KeyI", ctrlKey: true, shiftKey: true };
  press(chord);
  expect(press({ ...chord, repeat: true }).defaultPrevented).toBe(true);
  expect(deps.actions.current.onOpenInbox).toHaveBeenCalledOnce();
});

it.each(Object.entries(LAYOUT_SHORTCUTS))(
  "dispatches %s only in the workspace",
  (command, preset) => {
    saveKeybindingOverride(command, { shortcut: "Option+KeyQ" });
    expect(press({ key: "q", code: "KeyQ", altKey: true }).defaultPrevented).toBe(true);
    expect(deps.actions.current.onArrangeActiveTab).toHaveBeenCalledWith(preset);
    vi.mocked(deps.actions.current.onArrangeActiveTab).mockClear();
    press({ key: "q", code: "KeyQ", altKey: true, repeat: true });
    press({ key: "q", code: "KeyQ", altKey: true, isComposing: true });
    deps.settingsOpenRef.current = true;
    press({ key: "q", code: "KeyQ", altKey: true });
    expect(deps.actions.current.onArrangeActiveTab).not.toHaveBeenCalled();
  },
);

it("keeps workspace layout and editor find shortcuts out of Servers", () => {
  deps.serversViewOpenRef!.current = true;
  saveKeybindingOverride("Pane: Toggle Maximized", { shortcut: "Option+KeyQ" });
  press({ key: "q", code: "KeyQ", altKey: true });
  expect(deps.onToggleMaximizePane).not.toHaveBeenCalled();
  editorFind.mockClear();
  press({ key: "f", code: "KeyF", ctrlKey: true });
  expect(editorFind).not.toHaveBeenCalled();
});

it.each([
  ["i", "onOpenInbox"],
  ["l", "onOpenNotes"],
  ["y", "onOpenTasks"],
  ["u", "onOpenAutomations"],
] as const)("opens the existing surface with Ctrl+Shift+%s", (key, handler) => {
  expect(
    press({ key, code: `Key${key.toUpperCase()}`, ctrlKey: true, shiftKey: true }).defaultPrevented,
  ).toBe(true);
  expect(deps.actions.current[handler]).toHaveBeenCalledOnce();
});

it("reaches an approval popup from inside a Modal without deciding it or closing the dialog", async () => {
  const close = vi.fn();
  const decide = vi.fn();
  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        createElement(Listener),
        createElement(Modal, {
          title: "Edit",
          onClose: close,
          children: createElement("input", { "aria-label": "Name" }),
        }),
      ),
    ),
  );
  const field = document.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
  field.focus();
  const region = document.createElement("div");
  region.dataset.toastRegion = "top-center";
  region.innerHTML =
    '<article class="notification-request"><button>Open session</button><button>Allow</button><button>Deny</button></article>';
  const [open, allow, deny] = [...region.querySelectorAll("button")];
  for (const button of [allow, deny]) button.addEventListener("click", decide);
  document.body.append(region);
  const chord = { key: "j", code: "KeyJ", ctrlKey: true, shiftKey: true };
  expect(press(chord).defaultPrevented).toBe(true);
  // Focus lands on the safe control, never on a decision, and nothing is decided.
  expect(document.activeElement).toBe(open);
  expect(decide).not.toHaveBeenCalled();
  expect(region.closest("[inert]")).toBeNull();
  // Escape hands focus back to the dialog's field without closing the dialog.
  open.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  expect(document.activeElement).toBe(field);
  expect(close).not.toHaveBeenCalled();
  // A disabled chord does nothing.
  saveKeybindingOverride("App: Focus Approval Requests", { disabled: true });
  expect(press(chord).defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(field);
  region.remove();
});

it("lets a real Modal own workspace chords and resumes them after dismissal", async () => {
  const close = vi.fn();
  deps.actions.current.onClosePane = vi.fn();
  deps.actions.current.onCloseOtherTabs = vi.fn();
  deps.actions.current.onCloseAllTabs = vi.fn();
  deps.actions.current.onNext = vi.fn();
  saveKeybindingOverride("Pane: Toggle Maximized", { shortcut: "Option+KeyQ" });
  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        createElement(Listener),
        createElement(Modal, {
          title: "Edit",
          onClose: close,
          children: createElement("input", { "aria-label": "Name" }),
        }),
      ),
    ),
  );
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
  input.focus();
  editorFind.mockClear();
  const owned = vi.fn();
  input.addEventListener("keydown", owned);
  for (const init of [
    { key: "w", ctrlKey: true },
    { key: "w", metaKey: true },
    { key: "w", ctrlKey: true, shiftKey: true },
    { key: "n", ctrlKey: true },
    { key: "Tab", ctrlKey: true },
    { key: "f", ctrlKey: true },
    { key: "i", ctrlKey: true, shiftKey: true },
    { key: "q", code: "KeyQ", altKey: true },
  ]) {
    const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    // Tab remains owned by the modal's shared focus trap.
    if (init.key !== "Tab") expect(event.defaultPrevented).toBe(false);
  }
  expect(deps.actions.current.onClosePane).not.toHaveBeenCalled();
  expect(deps.actions.current.onCloseOtherTabs).not.toHaveBeenCalled();
  expect(deps.actions.current.onCloseAllTabs).not.toHaveBeenCalled();
  expect(deps.actions.current.onNext).not.toHaveBeenCalled();
  expect(deps.actions.current.onNew).not.toHaveBeenCalled();
  expect(deps.actions.current.onOpenInbox).not.toHaveBeenCalled();
  expect(deps.onToggleMaximizePane).not.toHaveBeenCalled();
  expect(editorFind).not.toHaveBeenCalled();
  expect(owned).toHaveBeenCalled();
  saveKeybindingOverride("App: Toggle Full Screen", { shortcut: "Option+KeyZ" });
  const presentation = new KeyboardEvent("keydown", {
    key: "z",
    code: "KeyZ",
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  input.dispatchEvent(presentation);
  expect(presentation.defaultPrevented).toBe(true);
  expect(fullscreen).toHaveBeenCalledOnce();
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  expect(close).toHaveBeenCalledOnce();
  await act(async () => root.render(createElement(Listener)));
  press({ key: "w", ctrlKey: true });
  expect(deps.actions.current.onClosePane).toHaveBeenCalledOnce();
});
