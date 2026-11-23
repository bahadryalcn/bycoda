// @vitest-environment happy-dom
import { act, createElement, type ComponentProps, type KeyboardEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveAgent } from "../../features/sessions/model/liveAgents";

const native = vi.hoisted(() => ({
  startDragging: vi.fn(),
  isMaximized: vi.fn(async () => false),
  isFullscreen: vi.fn(async () => false),
  onResized: vi.fn(async () => () => {}),
  onFocusChanged: vi.fn(async () => () => {}),
  toggleMaximize: vi.fn(async () => {}),
  setFullscreen: vi.fn(async () => {}),
  minimize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
// Placement is tested by the shared Popover; keep its accessible surface here.
vi.mock("../../shared/ui/Popover", async () => ({
  ...(await vi.importActual<typeof import("../../shared/ui/Popover")>("../../shared/ui/Popover")),
  Popover: ({
    children,
    anchor: _anchor,
    align: _align,
    width: _width,
    maxHeight: _maxHeight,
    onDismiss,
    side: _side,
    ...props
  }: ComponentProps<"div"> & Record<string, unknown>) =>
    createElement(
      "div",
      {
        ...props,
        // The real Popover owns Escape dismissal; keep it observable here.
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
          (props.onKeyDown as ((e: KeyboardEvent<HTMLDivElement>) => void) | undefined)?.(event);
          if (event.key === "Escape") (onDismiss as (reason: string) => void)("escape");
        },
      },
      children,
    ),
}));
import { graphemeLength } from "../../shared/lib/text/truncate";
import {
  DetachedWorkingBar,
  detachedAgentStatus,
  detachedAgentTitle,
  detachedBarStatus,
} from "./DetachedWorkingBar";

const agent = (id: string, overrides: Partial<LiveAgent> = {}): LiveAgent => ({
  id,
  cwd: "/project",
  title: id,
  harness: "codex",
  activity: 'node -e "VERY_LONG_SECRET_COMMAND"'.repeat(500),
  needsApproval: false,
  done: false,
  ...overrides,
});
let root: Root;
let container: HTMLDivElement;
let selected: ReturnType<typeof vi.fn>;
function render(agents: LiveAgent[]) {
  act(() => root.render(createElement(DetachedWorkingBar, { agents, onSelectAgent: selected })));
}
function pointer(target: EventTarget, type: string, x: number, y: number, button = 0) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 1,
        clientX: x,
        clientY: y,
        button,
        buttons: 1,
      }),
    );
  });
}

describe("detached working header", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    native.startDragging.mockReset();
    native.startDragging.mockResolvedValue(undefined);
    selected = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("maximizes and restores by double clicking the top header, excluding controls", async () => {
    render([agent("one")]);
    const bar = container.querySelector("[data-detached-working-bar]")!;
    await act(async () => {
      bar.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      bar.querySelector("div[aria-hidden]")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(native.toggleMaximize).toHaveBeenCalledTimes(2);
    await act(async () => {
      container
        .querySelector("[aria-haspopup=menu]")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      container
        .querySelector('[aria-label="Maximize window"]')!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(native.toggleMaximize).toHaveBeenCalledTimes(2);
  });

  it("keeps native window controls in the top header without running conversations", async () => {
    render([]);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Minimize window"]')!.click(),
    );
    expect(native.minimize).toHaveBeenCalledOnce();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Close window"]')!.click(),
    );
    expect(native.close).toHaveBeenCalledOnce();
  });

  it("drags the native window only after blank-header pointer movement exceeds threshold", async () => {
    render([agent("one")]);
    const label = container.querySelector("[data-detached-working-bar] > div[aria-hidden]")!;
    pointer(label, "pointerdown", 10, 10);
    pointer(window, "pointermove", 13, 10);
    expect(native.startDragging).not.toHaveBeenCalled();
    await act(async () => pointer(window, "pointermove", 16, 10));
    expect(native.startDragging).toHaveBeenCalledOnce();
    pointer(window, "pointermove", 30, 10);
    expect(native.startDragging).toHaveBeenCalledOnce();
  });

  it("keeps controls clickable and exposes short bounded rows without raw tool commands", () => {
    render([
      agent("one", {
        title: "Long session title ".repeat(500),
        needsApproval: true,
        ownerWindowLabel: "window-2",
      }),
    ]);
    const trigger = container.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")!;
    // The count is visible; the noun and aggregate state live in the accessible name.
    expect(trigger.textContent).toBe("1");
    expect(trigger.getAttribute("aria-label")).toContain("1 session ·");
    expect(trigger.getAttribute("aria-label")).not.toContain("1 sessions");
    pointer(trigger, "pointerdown", 10, 10);
    pointer(window, "pointermove", 30, 10);
    expect(native.startDragging).not.toHaveBeenCalled();
    act(() => trigger.click());
    const menu = container.querySelector<HTMLElement>("[role=menu]")!;
    const item = menu.querySelector<HTMLButtonElement>("[role=menuitem]")!;
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    // The row shows the bounded title; state and owner window live in its accessible label.
    expect(item.dataset.menuLabel!.split(" · ")[0]!.length).toBeLessThanOrEqual(72);
    expect(item.dataset.menuLabel).toContain("Needs input · Other window");
    expect(container.textContent).not.toContain("VERY_LONG_SECRET_COMMAND");
    expect(container.querySelector("select")).toBeNull();
    act(() => item.click());
    expect(selected).toHaveBeenCalledWith("one");
    expect(container.querySelector("[role=menu]")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("supports keyboard navigation, Escape, and completed status", () => {
    render([agent("one"), agent("two", { done: true })]);
    const trigger = container.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")!;
    expect(trigger.textContent).toBe("2");
    expect(trigger.getAttribute("aria-label")).toContain("2 sessions");
    act(() =>
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    );
    const items = container.querySelectorAll<HTMLButtonElement>("[role=menuitem]");
    expect(document.activeElement).toBe(items[0]);
    act(() =>
      items[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    );
    expect(document.activeElement).toBe(items[1]);
    expect(items[1].dataset.menuLabel).toContain("Done");
    act(() =>
      items[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(container.querySelector("[role=menu]")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("cancels blank-space drag tracking on pointer cancellation and unmount", () => {
    render([agent("one")]);
    const bar = container.querySelector("[data-detached-working-bar]")!;
    pointer(bar, "pointerdown", 10, 10);
    pointer(window, "pointercancel", 10, 10);
    pointer(window, "pointermove", 30, 10);
    expect(native.startDragging).not.toHaveBeenCalled();
    pointer(bar, "pointerdown", 10, 10);
    act(() => root.unmount());
    pointer(window, "pointermove", 30, 10);
    expect(native.startDragging).not.toHaveBeenCalled();
    root = createRoot(container);
  });

  it("does not offer an empty picker or drag on a secondary mouse button", () => {
    render([]);
    expect(container.querySelector("[aria-haspopup=menu]")).toBeNull();
    const bar = container.querySelector("[data-detached-working-bar]")!;
    pointer(bar, "pointerdown", 10, 10, 2);
    pointer(window, "pointermove", 30, 10);
    expect(native.startDragging).not.toHaveBeenCalled();
    expect(container.querySelector("[role=menu]")).toBeNull();
  });

  it("captions the bar with the aggregate state of finished and failed sessions", () => {
    render([agent("one", { done: true }), agent("two", { done: true, issue: "failed" })]);
    expect(container.querySelector("[aria-haspopup=menu]")?.getAttribute("aria-label")).toContain(
      "Failed",
    );
    render([agent("one", { done: true })]);
    expect(container.querySelector("[aria-haspopup=menu]")?.getAttribute("aria-label")).toContain(
      "Done",
    );
  });

  it("marks other-window sessions without repeating their status in visible copy", () => {
    render([
      agent("one", { needsApproval: true }),
      agent("two", { done: true, ownerWindowLabel: "window-2" }),
    ]);
    act(() => container.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")!.click());
    const items = container.querySelectorAll<HTMLButtonElement>("[role=menuitem]");
    expect(items[0].getAttribute("aria-label")).toContain("Needs input");
    expect(items[0].getAttribute("aria-label")).not.toContain("Other window");
    expect(items[1].getAttribute("aria-label")).toContain("Other window");
    expect(items[1].textContent).not.toContain("Other window");
  });
});

describe("detachedAgentStatus", () => {
  const t = (text: string) => text;
  it("ranks issue, done, needs input, waiting, then working", () => {
    const waiting = { kind: "tasks", count: 1 } as const;
    expect(detachedAgentStatus(agent("a", { waiting }), t)).toBe("Waiting");
    expect(detachedAgentStatus(agent("a"), t)).toBe("Working");
    expect(detachedAgentStatus(agent("a", { waiting, needsApproval: true }), t)).toBe(
      "Needs input",
    );
    expect(detachedAgentStatus(agent("a", { waiting, done: true }), t)).toBe("Done");
    expect(detachedAgentStatus(agent("a", { waiting, issue: "failed" }), t)).toBe("Failed");
  });
});

describe("detachedAgentTitle", () => {
  it("truncates by grapheme so a multi-code-unit emoji is never split", () => {
    // Each family emoji is one grapheme but five UTF-16 code units.
    const emoji = "🧑‍💻";
    const title = detachedAgentTitle(emoji.repeat(80), "Untitled session");
    expect(graphemeLength(title)).toBe(72);
    expect(title).toBe(`${emoji.repeat(71)}…`);
  });

  it("keeps short titles and falls back when the title is blank", () => {
    expect(detachedAgentTitle("  Fix   bug \n now ", "Untitled session")).toBe("Fix bug now");
    expect(detachedAgentTitle("   ", "Untitled session")).toBe("Untitled session");
  });
});

describe("detachedBarStatus", () => {
  const waiting = { kind: "tasks", count: 1 } as const;
  it("reports the aggregate state instead of always reading Working", () => {
    expect(detachedBarStatus([])).toBe("done");
    expect(detachedBarStatus([agent("a", { done: true })])).toBe("done");
    expect(detachedBarStatus([agent("a", { done: true }), agent("b", { done: true })])).toBe(
      "done",
    );
    expect(detachedBarStatus([agent("a", { waiting })])).toBe("waiting");
    expect(detachedBarStatus([agent("a", { done: true, issue: "failed" })])).toBe("failed");
    expect(
      detachedBarStatus([agent("a", { done: true }), agent("b", { issue: "failed", done: true })]),
    ).toBe("failed");
    expect(detachedBarStatus([agent("a")])).toBe("working");
    expect(detachedBarStatus([agent("a", { issue: "retrying" })])).toBe("working");
  });

  it("ranks needs input above working, working above failed, failed above waiting and done", () => {
    expect(detachedBarStatus([agent("a"), agent("b", { needsApproval: true })])).toBe("needsInput");
    expect(detachedBarStatus([agent("a", { done: true, issue: "failed" }), agent("b")])).toBe(
      "working",
    );
    expect(
      detachedBarStatus([agent("a", { waiting }), agent("b", { done: true, issue: "failed" })]),
    ).toBe("failed");
    expect(detachedBarStatus([agent("a", { waiting }), agent("b", { done: true })])).toBe(
      "waiting",
    );
  });
});
