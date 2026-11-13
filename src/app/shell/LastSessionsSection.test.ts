// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LastSessionsRows, LastSessionsSection } from "./LastSessionsSection";
import { pathKey } from "../../shared/lib/paths";
import { formatRelative } from "../../features/sessions/model/recentSessions";
import { resetRetainedState } from "../../shared/hooks/useRetainedState";
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
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(async () => null) }));
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
  resetRetainedState();
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-index") ? 64 : 480;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(480);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("advances idle relative labels from the shared minute clock and unsubscribes on unmount", async () => {
  vi.useFakeTimers();
  const now = new Date("2026-10-21T08:00:00Z").getTime();
  vi.setSystemTime(now);
  const updatedAt = now - 60_000;
  await act(async () =>
    root.render(
      createElement(LastSessionsRows, {
        ...appearance,
        rows: [{ ...data.stored[0], updatedAt, harness: "codex", pinnable: true, remote: false }],
        searchActive: false,
        onOpenProject: vi.fn(),
      }),
    ),
  );
  expect(container.textContent).toContain(formatRelative(updatedAt, now));
  await act(async () => vi.advanceTimersByTime(120_000));
  expect(container.textContent).toContain(formatRelative(updatedAt, now + 120_000));
  await act(async () => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
});
it("keeps collapse and radio count selection with focus returning to the native trigger", async () => {
  await act(async () =>
    root.render(
      createElement(LastSessionsSection, {
        ...appearance,
        source: { history: [], live: [] },
        projectKeys: new Set([pathKey("/work/project")]),
        enabled: true,
        searchActive: false,
        onOpenProject: vi.fn(),
      }),
    ),
  );
  const collapse = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
  expect(collapse.getAttribute("data-button-size")).toBe("sm");
  expect(collapse.closest("[data-compact-rail]")).not.toBeNull();
  const title = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Last sessions",
  )!;
  expect(title.getAttribute("data-button-selected")).toBeNull();
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
it("keeps selected session open without pin actions, including keyboard context menu", async () => {
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
      }),
    ),
  );
  const session = container.querySelector<HTMLButtonElement>('button[aria-current="true"]')!;
  expect(session.getAttribute("data-button-selected")).toBe("true");
  await act(async () => session.click());
  expect(open).toHaveBeenCalledExactlyOnceWith("recent-one", "/work/project");
  await act(async () => session.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  expect(open).toHaveBeenLastCalledWith("recent-one", "/work/project", { keepOpen: true });
  expect(container.querySelector('button[aria-label="Pin session"]')).toBeNull();
  expect(pin).not.toHaveBeenCalled();
  await act(async () =>
    session.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }),
    ),
  );
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("opens the global workspace from its title independently of collapse, even when empty", async () => {
  const original = data.stored;
  data.stored = [];
  const open = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(LastSessionsSection, {
          ...appearance,
          source: { history: [], live: [] },
          projectKeys: new Set([pathKey("/work/project")]),
          enabled: true,
          searchActive: false,
          onOpenProject: vi.fn(),
          onOpenLastSessions: open,
          lastSessionsOpen: true,
        }),
      ),
    );
    const title = container.querySelector<HTMLButtonElement>('button[aria-current="page"]')!;
    const collapse = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    expect(title.textContent).toContain("Last sessions");
    // One header surface: the open state is the host's, not a second pill on the label.
    const header = collapse.closest("[data-action-host]")!;
    expect(header.contains(title)).toBe(true);
    expect(header.hasAttribute("data-selected")).toBe(true);
    expect(header.contains(title)).toBe(true);
    await act(async () => collapse.click());
    expect(open).not.toHaveBeenCalled();
    expect(collapse.getAttribute("aria-expanded")).toBe("false");
    await act(async () => title.click());
    expect(open).toHaveBeenCalledOnce();
    expect(collapse.getAttribute("aria-expanded")).toBe("false");
  } finally {
    data.stored = original;
  }
});

it("applies the selected total count to pinned rows and persists the new three-row option", async () => {
  const original = data.stored;
  data.stored = Array.from({ length: 18 }, (_, index) => ({
    ...original[0],
    id: `session-${index}`,
    updatedAt: index + 1,
    pinned: index < 13,
  }));
  localStorage.setItem("bycoda.lastSessions", JSON.stringify({ count: 5 }));
  try {
    await act(async () =>
      root.render(
        createElement(LastSessionsSection, {
          ...appearance,
          source: { history: [], live: [] },
          projectKeys: new Set([pathKey("/work/project")]),
          enabled: true,
          searchActive: false,
          onOpenProject: vi.fn(),
        }),
      ),
    );
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(5);
    const count = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    await act(async () => count.click());
    const three = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    ).find((node) => node.textContent === "Last 3")!;
    expect(three).toBeTruthy();
    await act(async () => three.click());
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(3);
    expect(JSON.parse(localStorage.getItem("bycoda.lastSessions")!).count).toBe(3);
    expect(document.activeElement).toBe(count);
  } finally {
    data.stored = original;
  }
});

it("marks only the working status dot so the root motion and focus state can pause it", async () => {
  const row = (status: "working" | "done") => ({
    ...data.stored[0],
    id: status,
    title: status,
    harness: "codex" as const,
    status,
    pinnable: true,
    remote: false,
  });
  await act(async () =>
    root.render(
      createElement(LastSessionsRows, {
        ...appearance,
        rows: [row("working"), row("done")],
        searchActive: false,
        onOpenProject: vi.fn(),
      }),
    ),
  );
  const working = container.querySelector(
    '[role="img"][aria-label="Working"] [data-working-variant="dot"]',
  );
  expect(working?.className).toContain("working-dot");
  expect(
    container.querySelector('[role="img"][aria-label="Done"] [data-working-variant]'),
  ).toBeNull();
  // The shared stylesheet pauses that class from the root attributes, with no per-row listeners.
  const css = readFileSync("src/styles/index.css", "utf8");
  expect(css).toMatch(
    /html:is\(\[data-decorative-motion="off"\], \[data-window-focus="off"\]\) \.working-dot \{\s*animation-play-state: paused/,
  );
});

it("bounds a large Last sessions collection while retaining its row actions", async () => {
  const rows = Array.from({ length: 180 }, (_, index) => ({
    ...data.stored[0],
    id: `large-${index}`,
    title: `Large session ${index}`,
    harness: "codex",
    updatedAt: index + 1,
    pinnable: true,
    remote: false,
  }));
  await act(async () =>
    root.render(
      createElement(LastSessionsRows, {
        ...appearance,
        rows,
        searchActive: false,
        onOpenSession: vi.fn(),
        onOpenProject: vi.fn(),
      }),
    ),
  );
  expect(container.querySelector('[data-continuous-list="last-sessions:rail"]')).not.toBeNull();
  const mountedRows = container.querySelectorAll('[role="listitem"]').length;
  expect(mountedRows).toBeGreaterThan(0);
  expect(mountedRows).toBeLessThan(rows.length);
  expect(container.textContent).toContain("Large session 0");
});

it("lists projectless sessions as No project without an Open project action", async () => {
  const original = data.stored;
  data.stored = [{ ...original[0], id: "blank", cwd: "~", title: "Scratch chat" }, original[0]];
  try {
    await act(async () =>
      root.render(
        createElement(LastSessionsSection, {
          ...appearance,
          source: { history: [], live: [] },
          projectKeys: new Set([pathKey("/work/project")]),
          enabled: true,
          searchActive: false,
          onOpenProject: vi.fn(),
        }),
      ),
    );
    const items = Array.from(container.querySelectorAll<HTMLElement>('[role="listitem"]'));
    const blank = items.find((item) => item.textContent?.includes("Scratch chat"))!;
    expect(blank).toBeTruthy();
    const main = blank.querySelector<HTMLButtonElement>("button")!;
    expect(main.getAttribute("aria-label")).toContain("No project");
    expect(blank.querySelector('button[aria-label="Pin session"]')).toBeNull();
    await act(async () =>
      main.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "F10",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    const menu = document.querySelector('[role="menu"]')!;
    expect(menu).toBeNull();
  } finally {
    data.stored = original;
  }
});
