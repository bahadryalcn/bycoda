// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { McpHub } from "../hooks/useMcpHub";
import type { McpCatalogEntry } from "../model/mcpCatalog";
import type { McpServerRow } from "../model/mcpSettingsCache";
import { McpServerDetail, type McpRowActions } from "./McpServerDetail";

// Keep this fixture independent of unrelated application barrel cycles.
vi.mock("../../sessions", () => import("../../sessions/ui/HarnessIcon"));
vi.mock("../../../platform/tauri/fs", () => ({ revealPath: vi.fn(async () => {}) }));

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: (...args: unknown[]) => invoke(...args),
}));

const SAVED = '{"command":"docs"}';
const SECRET = "sk-secret-value-123";
const EDITED = `{"command":"docs","env":{"TOKEN":"${SECRET}"}}`;

const server: McpServerRow = {
  provider: "claude",
  name: "docs",
  scope: "user",
  configPath: "/home/.claude.json",
  transport: "stdio",
  status: "Connected",
};
const entry: McpCatalogEntry = { name: "docs", configs: [server] };

const onClose = vi.fn();
const remove = vi.fn(async () => {});
let container: HTMLDivElement;
let root: Root;

const hub = {
  pending: false,
  error: "",
  saving: false,
  waiting: "",
  busy: "",
  dismissError: vi.fn(),
  refresh: vi.fn(async () => {}),
  setMode: vi.fn(async () => {}),
  setDirect: vi.fn(async () => {}),
  signIn: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
} as unknown as McpHub;

function actions(): McpRowActions {
  return {
    locked: false,
    busyKey: "",
    canToggle: () => false,
    toggleBlockedReason: () => undefined,
    setEnabled: vi.fn(async () => {}),
    providerSignIn: vi.fn(async () => {}),
    remove,
    refresh: vi.fn(async () => {}),
  };
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  invoke.mockReset();
  onClose.mockClear();
  remove.mockClear();
  invoke.mockImplementation(async (command: string, args: { config?: string }) =>
    command === "mcp_server_config_read"
      ? { config: SAVED, revision: "r1" }
      : command === "mcp_server_config_write"
        ? { config: args.config, revision: "r2" }
        : undefined,
  );
  await act(async () => {
    root.render(
      createElement(McpServerDetail, {
        entry,
        status: "configured",
        cwd: "/project",
        globalOnly: false,
        hub,
        actions: actions(),
        onClose,
      }),
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const editor = () => document.querySelector<HTMLTextAreaElement>("textarea")!;

function control(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) =>
      element.getAttribute("aria-label") === label || element.textContent?.trim() === label,
  );
}

async function press(label: string) {
  const button = control(label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}

async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      editor(),
      value,
    );
    editor().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const prompted = () => document.body.textContent?.includes("Save changes before leaving?");
const writes = () => invoke.mock.calls.filter(([command]) => command === "mcp_server_config_write");

it("closes at once when the configuration has no unsaved edit", async () => {
  await press("Close");
  expect(prompted()).toBe(false);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("asks before the close button drops an edited configuration, and Keep editing retains it", async () => {
  await type(EDITED);
  await press("Close");
  expect(prompted()).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  await press("Keep editing");
  expect(onClose).not.toHaveBeenCalled();
  expect(editor().value).toBe(EDITED);
  expect(writes()).toHaveLength(0);
});

it("asks before Escape drops an edited configuration", async () => {
  await type(EDITED);
  await act(async () => {
    editor().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(prompted()).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  await press("Keep editing");
  expect(editor().value).toBe(EDITED);
});

it("never puts the draft text in the leave prompt", async () => {
  await type(EDITED);
  await press("Close");
  const prompts = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')];
  expect(prompts.some((dialog) => dialog.textContent?.includes("Save changes before leaving?"))).toBe(
    true,
  );
  for (const dialog of prompts) {
    if (dialog.textContent?.includes("Save changes before leaving?"))
      expect(dialog.textContent).not.toContain(SECRET);
  }
});

it("discards the edit and closes without writing the file", async () => {
  await type(EDITED);
  await press("Close");
  await press("Discard and leave");
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(writes()).toHaveLength(0);
});

it("saves with the loaded revision before closing", async () => {
  await type(EDITED);
  await press("Close");
  await press("Save and leave");
  expect(writes()).toHaveLength(1);
  expect(writes()[0]![1]).toMatchObject({
    config: EDITED,
    expectedRevision: "r1",
    provider: "claude",
    name: "docs",
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("keeps the sheet and the draft when the save is refused", async () => {
  invoke.mockImplementation(async (command: string) => {
    if (command === "mcp_server_config_read") return { config: SAVED, revision: "r1" };
    if (command === "mcp_server_config_write")
      throw new Error("Configuration changed; reload before saving");
    return undefined;
  });
  await type(EDITED);
  await press("Close");
  await press("Save and leave");
  expect(onClose).not.toHaveBeenCalled();
  expect(editor().value).toBe(EDITED);
});

it("does not offer Discard or close while a save is in flight", async () => {
  invoke.mockImplementation((command: string) =>
    command === "mcp_server_config_read"
      ? Promise.resolve({ config: SAVED, revision: "r1" })
      : command === "mcp_server_config_write"
        ? new Promise(() => {})
        : Promise.resolve(undefined),
  );
  await type(EDITED);
  await press("Save");
  await press("Close");
  expect(prompted()).toBe(true);
  expect(control("Discard and leave")).toBeUndefined();
  expect(onClose).not.toHaveBeenCalled();
  expect(editor().value).toBe(EDITED);
});

it("asks before Remove can end the entry that holds an edited configuration", async () => {
  await type(EDITED);
  await press("Remove");
  expect(prompted()).toBe(true);
  expect(remove).not.toHaveBeenCalled();
  await press("Keep editing");
  expect(remove).not.toHaveBeenCalled();
  expect(editor().value).toBe(EDITED);
});
