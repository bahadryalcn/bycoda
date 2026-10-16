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

vi.mock("../../../features/files/editor/editorFindBridge", () => ({
  handleEditorFindKey: () => false,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

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

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  deps = {
    actions: ref({
      onArrangeActiveTab: vi.fn(),
      onOpenInbox: vi.fn(),
      onOpenNotes: vi.fn(),
      onOpenTasks: vi.fn(),
      onOpenAutomations: vi.fn(),
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
