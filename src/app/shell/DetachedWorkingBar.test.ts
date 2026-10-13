// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
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
vi.mock("../../shared/ui/Popover", () => ({
  Popover: ({
    children,
    anchor: _anchor,
    align: _align,
    width: _width,
    maxHeight: _maxHeight,
    onDismiss: _dismiss,
    ...props
  }: ComponentProps<"div"> & Record<string, unknown>) => createElement("div", props, children),
}));
import { DetachedWorkingBar } from "./DetachedWorkingBar";

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
      bar.querySelector("span")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
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
    const label = container.querySelector("[data-detached-working-bar] > span")!;
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
    expect(trigger.textContent).toContain("1 conversation");
    expect(trigger.textContent).not.toContain("1 conversations");
    pointer(trigger, "pointerdown", 10, 10);
    pointer(window, "pointermove", 30, 10);
    expect(native.startDragging).not.toHaveBeenCalled();
    act(() => trigger.click());
    const menu = container.querySelector<HTMLElement>("[role=menu]")!;
    const item = menu.querySelector<HTMLButtonElement>("[role=menuitem]")!;
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(menu.id);
    expect(menu.style.maxWidth).toBe("calc(100vw - 16px)");
    expect(item.querySelector(".truncate")!.textContent!.length).toBeLessThanOrEqual(72);
    expect(item.textContent).toContain("Needs input · Other window");
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
    expect(trigger.textContent).toContain("2 conversations");
    act(() =>
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    );
    const items = container.querySelectorAll<HTMLButtonElement>("[role=menuitem]");
    expect(document.activeElement).toBe(items[0]);
    act(() =>
      items[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    );
    expect(document.activeElement).toBe(items[1]);
    expect(items[1].textContent).toContain("Done");
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
    expect(container.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")!.disabled).toBe(true);
    const bar = container.querySelector("[data-detached-working-bar]")!;
    pointer(bar, "pointerdown", 10, 10, 2);
    pointer(window, "pointermove", 30, 10);
    expect(native.startDragging).not.toHaveBeenCalled();
    expect(container.querySelector("[role=menu]")).toBeNull();
  });
});
