// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LastSessionsRows, LastSessionsSection } from "./LastSessionsSection";
import { pathKey } from "../../shared/lib/paths";
const data = vi.hoisted(() => ({
  stored: [
    {
      id: "recent-one",
      cwd: "/work/project",
      title: "Saved session",
      harness: "codex",
      model: "",
      updatedAt: Date.now(),
      pinned: false,
    },
  ],
  refresh: vi.fn(),
}));
vi.mock("../../features/sessions/hooks/useRecentSessions", () => ({
  useRecentSessions: () => ({ rows: data.stored, refresh: data.refresh }),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
let root: Root, container: HTMLDivElement;
const appearance = {
  groupLabels: {},
  groupColors: {},
  groupCustomColors: {},
  groupLogos: {},
  groupMascots: {},
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});
it("keeps collapse and radio count selection with focus returning to the native trigger", async () => {
  await act(async () =>
    root.render(
      createElement(LastSessionsSection, {
        ...appearance,
        source: { history: [], live: [], onPin: vi.fn(async () => {}) },
        projectKeys: new Set([pathKey("/work/project")]),
        enabled: true,
        searchActive: false,
        onOpenProject: vi.fn(),
      }),
    ),
  );
  const collapse = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
  expect(collapse.getAttribute("aria-expanded")).toBe("true");
  await act(async () => collapse.click());
  expect(container.querySelector('[role="list"]')).toBeNull();
  await act(async () => collapse.click());
  const count = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  count.focus();
  await act(async () => count.click());
  const option = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
  ).find((n) => n.textContent?.includes("Last 20"))!;
  expect(option).toBeTruthy();
  await act(async () => option.click());
  expect(count.getAttribute("aria-label")).toContain("Last 20");
  expect(document.activeElement).toBe(count);
  expect(JSON.parse(localStorage.getItem("bycoda.lastSessions")!).count).toBe(20);
});
it("keeps selected session open, independent pin and keyboard context actions", async () => {
  const open = vi.fn(),
    pin = vi.fn();
  await act(async () =>
    root.render(
      createElement(LastSessionsRows, {
        ...appearance,
        rows: [{ ...data.stored[0], harness: "codex", pinnable: true, remote: false }],
        activeSessionId: "recent-one",
        searchActive: false,
        onOpenSession: open,
        onOpenProject: vi.fn(),
        onTogglePin: pin,
      }),
    ),
  );
  const session = container.querySelector<HTMLButtonElement>('button[aria-current="true"]')!;
  expect(session.getAttribute("data-button-selected")).toBe("true");
  await act(async () => session.click());
  expect(open).toHaveBeenCalledExactlyOnceWith("recent-one");
  const pinButton = container.querySelector<HTMLButtonElement>('button[aria-label="Pin session"]')!;
  await act(async () => pinButton.click());
  expect(pin).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledTimes(1);
  await act(async () =>
    session.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }),
    ),
  );
  expect(document.querySelector('[role="menu"]')).toBeTruthy();
  expect(document.querySelector('[role="menu"]')?.textContent).toContain("Open project");
});
