// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { ProjectTerminalDock as Dock } from "../../projects/model/projectTerminal";

vi.mock("../../../shared/ui/lazySurface", () => ({
  lazySurface: () => () => null,
}));
vi.mock("../../../app/shell/TitleBar", () => ({
  IconButton: ({ label, onClick }: { label: string; onClick: () => void }) =>
    createElement("button", { "aria-label": label, onClick }),
}));
vi.mock("../model/terminalProfiles", () => ({
  useTerminalProfiles: () => null,
  useTerminalProfile: () => undefined,
  effectiveProfileId: () => undefined,
}));
vi.mock("../../host-tools/SessionHostTools", () => ({
  SessionHostTools: ({ sessionId }: { sessionId: string }) =>
    createElement("div", { "data-tools-session": sessionId }),
}));
import { ProjectTerminalDock } from "./ProjectTerminalDock";

it("resizes the terminal list by drag and keyboard, resets it, and follows dock width", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let bodyWidth = 900;
  const width = vi
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockImplementation(function () {
      return this.classList.contains("terminal-body") ? bodyWidth : 0;
    });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onSizeCommit = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(ProjectTerminalDock, {
          dock: {
            projectPath: "/project",
            side: "bottom",
            size: 220,
            open: true,
            pane: {
              id: "pane",
              activeFileId: "one",
              files: [{ id: "one", path: "Terminal 1", cwd: "/project", terminal: true }],
            },
          } as Dock,
          focused: true,
          onFocus: vi.fn(),
          onHide: vi.fn(),
          onSideChange: vi.fn(),
          onSizePaint: vi.fn(),
          onSizeCommit,
          onAddTerminal: vi.fn(),
          onSelectTerminal: vi.fn(),
          onCloseTerminal: vi.fn(),
          onCloseOtherTerminals: vi.fn(),
          onReorderTerminals: vi.fn(),
        }),
      ),
    );
    const sash = host.querySelector<HTMLElement>(".terminal-sidebar-sash")!;
    const sidebar = host.querySelector<HTMLElement>(".terminal-sidebar")!;
    sash.setPointerCapture = vi.fn();
    sash.releasePointerCapture = vi.fn();
    expect(sash.getAttribute("aria-orientation")).toBe("vertical");
    expect(sash.tabIndex).toBe(0);
    expect(sidebar.style.width).toBe("200px");
    await act(async () => {
      sash.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: 200, button: 0 }),
      );
      window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 2, clientX: 450 }));
    });
    expect(sidebar.style.width).toBe("200px");
    await act(async () =>
      window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 300 })),
    );
    expect(sidebar.style.width).toBe("300px");
    await act(async () => window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 })));
    expect(sash.getAttribute("aria-valuenow")).toBe("300");
    expect(document.documentElement.classList.contains("is-resizing")).toBe(false);
    await act(async () =>
      sash.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })),
    );
    expect(sidebar.style.width).toBe("290px");
    await act(async () =>
      sash.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })),
    );
    expect(sidebar.style.width).toBe("480px");
    await act(async () => sash.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(sidebar.style.width).toBe("200px");
    bodyWidth = 260;
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(sidebar.style.width).toBe("140px");
    expect(sash.getAttribute("aria-valuemax")).toBe("140");
    await act(async () =>
      sash.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })),
    );
    expect(sidebar.style.width).toBe("80px");
    expect(onSizeCommit).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    width.mockRestore();
    vi.unstubAllGlobals();
  }
});
vi.mock("../../files/ui/ExplorerMenu", () => ({
  ExplorerMenu: ({
    items,
    onPick,
  }: {
    items: { kind: string; id?: string; label?: string }[];
    onPick: (id: string) => void;
  }) =>
    createElement(
      "div",
      { role: "menu" },
      items
        .filter((item) => item.kind === "item")
        .map((item) =>
          createElement("button", { key: item.id, onClick: () => onPick(item.id!) }, item.label),
        ),
    ),
}));

it("selects terminals with vertical keyboard navigation and closes the active terminal", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onSelectTerminal = vi.fn();
  const onCloseTerminal = vi.fn();
  const dock = {
    projectPath: "/project",
    side: "bottom",
    size: 220,
    open: true,
    pane: {
      id: "pane",
      activeFileId: "one",
      files: [
        { id: "one", path: "Terminal 1", cwd: "/project", terminal: true },
        { id: "two", path: "Terminal 2", cwd: "/project", terminal: true },
      ],
    },
  } as Dock;
  try {
    await act(async () => {
      root.render(
        createElement(ProjectTerminalDock, {
          dock,
          focused: false,
          onFocus: vi.fn(),
          onHide: vi.fn(),
          onSideChange: vi.fn(),
          onSizePaint: vi.fn(),
          onSizeCommit: vi.fn(),
          onAddTerminal: vi.fn(),
          onSelectTerminal,
          onCloseTerminal,
          onCloseOtherTerminals: vi.fn(),
          onReorderTerminals: vi.fn(),
        }),
      );
    });
    const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('[role="tablist"]')?.getAttribute("aria-orientation")).toBe(
      "vertical",
    );
    await act(async () => {
      tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });
    expect(onSelectTerminal).toHaveBeenCalledWith("two");
    expect(document.activeElement).toBe(tabs[1]);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Close — Terminal 1"]')?.click();
    });
    expect(onCloseTerminal).toHaveBeenCalledWith("one");
    expect(host.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe(
      tabs[0].id,
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("splits the targeted row and keeps both canvases visible while changing focus", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const onSplitTerminal = vi.fn();
  const onSelectTerminal = vi.fn();
  const onAddTerminalWithProfile = vi.fn();
  const dock = {
    projectPath: "/project",
    side: "bottom",
    size: 220,
    open: true,
    splitGroups: [["one", "two"]],
    pane: {
      id: "pane",
      activeFileId: "two",
      files: [
        { id: "one", path: "Terminal 1", cwd: "/project", terminal: true },
        { id: "two", path: "Terminal 2", cwd: "/project", terminal: true },
        { id: "three", path: "Terminal 3", cwd: "/other", terminal: true },
      ],
    },
  } as Dock;
  try {
    await act(async () =>
      root.render(
        createElement(ProjectTerminalDock, {
          dock,
          focused: true,
          onFocus: vi.fn(),
          onHide: vi.fn(),
          onSideChange: vi.fn(),
          onSizePaint: vi.fn(),
          onSizeCommit: vi.fn(),
          onAddTerminal: vi.fn(),
          onSplitTerminal,
          onSelectTerminal,
          onAddTerminalWithProfile,
          onCloseTerminal: vi.fn(),
          onCloseOtherTerminals: vi.fn(),
          onReorderTerminals: vi.fn(),
        }),
      ),
    );
    expect(host.querySelectorAll('[role="tabpanel"][aria-hidden="false"]')).toHaveLength(2);
    expect(host.querySelectorAll("button button")).toHaveLength(0);
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Split — Terminal 1"]')!.click(),
    );
    expect(onSplitTerminal).toHaveBeenCalledWith("one");
    expect(onSelectTerminal).not.toHaveBeenCalled();
    await act(async () =>
      host
        .querySelector("#terminal-panel-one")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true })),
    );
    expect(onSelectTerminal).toHaveBeenCalledWith("one");
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Launch Profile…"]')!.click(),
    );
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    await act(async () =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menu"] button'))
        .find((button) => button.textContent === "Split")!
        .click(),
    );
    expect(onSplitTerminal).toHaveBeenLastCalledWith("two");
    expect(host.querySelector('[role="menu"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("keeps the dock focused on terminals without duplicate footer navigation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const onSelectTerminal = vi.fn();
  const dock = {
    projectPath: "/project",
    side: "bottom",
    size: 260,
    open: true,
    pane: {
      id: "pane",
      activeFileId: "one",
      files: [{ id: "one", path: "Terminal 1", cwd: "/project", terminal: true }],
    },
  } as Dock;
  const props = {
    dock,
    focused: true,
    onFocus: vi.fn(),
    onHide: vi.fn(),
    onSideChange: vi.fn(),
    onSizePaint: vi.fn(),
    onSizeCommit: vi.fn(),
    onAddTerminal: vi.fn(),
    onSelectTerminal,
    onCloseTerminal: vi.fn(),
    onCloseOtherTerminals: vi.fn(),
    onReorderTerminals: vi.fn(),
  };
  try {
    await act(async () => root.render(createElement(ProjectTerminalDock, props)));
    expect(host.querySelector("[data-tools-session]")).toBeNull();
    expect(host.querySelector('[aria-label="Conversation tools"]')).toBeNull();
    expect(host.querySelector('[aria-label="Terminal"]')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[role="tab"]')!.click());
    expect(onSelectTerminal).toHaveBeenCalledWith("one");
    expect(host.querySelector("[data-tools-session]")).toBeNull();
    expect(host.querySelector('[role="tabpanel"]')?.getAttribute("aria-hidden")).toBe("false");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
