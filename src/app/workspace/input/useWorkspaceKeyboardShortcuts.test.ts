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

it("opens a directly assigned settings section and respects a disabled binding", () => {
  saveKeybindingOverride("Settings: Connections", { shortcut: "Option+KeyQ" });
  const event = press({ key: "q", code: "KeyQ", altKey: true });
  expect(event.defaultPrevented).toBe(true);
  expect(deps.actions.current.openSettings).toHaveBeenCalledExactlyOnceWith("connections");
  saveKeybindingOverride("Settings: Connections", { disabled: true });
  expect(press({ key: "q", code: "KeyQ", altKey: true }).defaultPrevented).toBe(false);
  expect(deps.actions.current.openSettings).toHaveBeenCalledTimes(1);
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
