// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const pty = vi.hoisted(() => ({
  spawnPty: vi.fn(async () => {}),
  killPty: vi.fn(async () => {}),
  resizePty: vi.fn(async () => {}),
  writePty: vi.fn(async () => {}),
  subscribePty: vi.fn(() => () => {}),
  getPtyStatus: vi.fn(async () => ({ foreground: null })),
}));
const xterm = vi.hoisted(() => ({
  instances: [] as Array<{
    options: { theme?: { foreground?: string; cursor?: string } };
    osc: Map<number, (data: string) => boolean>;
  }>,
}));
vi.mock("../../../platform/tauri/pty", () => pty);
vi.mock("../model/terminalLayout", () => ({
  fitTerminal: () => null,
  applyTerminalChrome: () => {},
  resetGridStretch: () => {},
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = {};
    osc = new Map<number, (data: string) => boolean>();
    constructor(options: { theme?: { foreground?: string; cursor?: string } }) {
      this.options = options;
      xterm.instances.push(this);
    }
    parser = {
      registerOscHandler: (code: number, handler: (data: string) => boolean) => {
        this.osc.set(code, handler);
        return { dispose() {} };
      },
    };
    buffer = {
      active: { type: "normal" },
      onBufferChange: () => ({ dispose() {} }),
    };
    open() {}
    loadAddon(addon: { activate: (terminal: unknown) => void }) {
      addon.activate(this);
    }
    registerLinkProvider() {
      return { dispose() {} };
    }
    focus() {}
    dispose() {}
    writeln() {}
    onData() {
      return { dispose() {} };
    }
    onRender() {
      return { dispose() {} };
    }
    attachCustomKeyEventHandler() {}
    attachCustomWheelEventHandler() {}
  },
}));
import { TerminalView } from "./TerminalView";
import { queueTerminalCommand } from "../model/terminalLaunchCommand";

it("runs an action once after shell startup, without replaying it on remount", async () => {
  const { host, root } = setup();
  queueTerminalCommand("action-terminal", "pnpm test");
  try {
    await act(async () =>
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(TerminalView, { id: "action-terminal", cwd: "/tmp", active: true }),
        ),
      ),
    );
    expect(pty.writePty).toHaveBeenCalledExactlyOnceWith("action-terminal", "pnpm test\r");
    await act(async () => root.render(null));
    await act(async () =>
      root.render(
        createElement(TerminalView, { id: "action-terminal", cwd: "/tmp", active: true }),
      ),
    );
    expect(pty.writePty).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

afterEach(() => {
  xterm.instances.length = 0;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("resolves scoped theme colors for xterm and six-digit OSC replies", async () => {
  const { host, root } = setup();
  host.style.setProperty("--terminal-text", "#aabbcc");
  host.style.setProperty("--terminal-canvas", "#112233");
  host.style.setProperty("--color-accent", "#778899");
  try {
    await act(async () =>
      root.render(
        createElement(TerminalView, {
          id: "theme-terminal",
          cwd: "/tmp",
          active: true,
        }),
      ),
    );
    const terminal = xterm.instances[0];
    expect(terminal.options.theme?.foreground).toBe("#aabbcc");
    expect(terminal.options.theme?.cursor).toBe("#778899");
    await act(async () => {
      terminal.osc.get(10)?.("?");
      terminal.osc.get(11)?.("?");
    });
    expect(pty.writePty).toHaveBeenCalledWith("theme-terminal", "\x1b]10;rgb:aaaa/bbbb/cccc\x1b\\");
    expect(pty.writePty).toHaveBeenCalledWith("theme-terminal", "\x1b]11;rgb:1111/2222/3333\x1b\\");
    host.style.setProperty("--terminal-text", "#ddeeff");
    await act(async () =>
      document.documentElement.style.setProperty("--terminal-test-theme", "updated"),
    );
    expect(terminal.options.theme?.foreground).toBe("#ddeeff");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    document.documentElement.style.removeProperty("--terminal-test-theme");
  }
});

function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const host = document.createElement("div");
  document.body.appendChild(host);
  return { host, root: createRoot(host) };
}

it("does not let StrictMode cleanup kill the replacement shell", async () => {
  const { host, root } = setup();
  try {
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(TerminalView, {
            id: "same-id",
            cwd: "/tmp",
            active: true,
          }),
        ),
      );
    });
    expect(pty.spawnPty).toHaveBeenCalledTimes(1);
    expect(pty.subscribePty).toHaveBeenCalledTimes(1);
    expect(pty.killPty).not.toHaveBeenCalled();
  } finally {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  }
  expect(pty.killPty).toHaveBeenCalledTimes(1);
});

it("waits for a pending same-id startup and cleanup before starting again", async () => {
  const { host, root } = setup();
  const operations: string[] = [];
  let releaseSpawn!: () => void;
  pty.subscribePty.mockImplementation(() => {
    operations.push("subscribe");
    return () => {
      operations.push("unsubscribe");
    };
  });
  pty.spawnPty
    .mockImplementationOnce(() => {
      operations.push("spawn old");
      return new Promise<void>((resolve) => {
        releaseSpawn = resolve;
      });
    })
    .mockImplementationOnce(async () => {
      operations.push("spawn replacement");
    });
  pty.killPty.mockImplementation(async () => {
    operations.push("kill");
  });
  // A new `key` remounts a fresh instance with the same PTY id, as moving a
  // terminal between the dock and a file pane does.
  const view = (key: string) =>
    createElement(TerminalView, {
      key,
      id: "moved",
      cwd: "/tmp",
      active: true,
    });
  try {
    await act(async () => {
      root.render(view("dock"));
    });
    await act(async () => {
      root.render(view("pane"));
    });
    expect(operations).toEqual(["subscribe", "spawn old"]);
    await act(async () => {
      releaseSpawn();
    });
    expect(operations).toEqual([
      "subscribe",
      "spawn old",
      "unsubscribe",
      "kill",
      "subscribe",
      "spawn replacement",
    ]);
  } finally {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  }
});

it("does not hold a different terminal behind another one's teardown", async () => {
  const { host, root } = setup();
  pty.spawnPty.mockImplementationOnce(() => new Promise<void>(() => {}));
  try {
    await act(async () => {
      root.render(createElement(TerminalView, { id: "first", cwd: "/tmp", active: true }));
    });
    await act(async () => {
      root.render(
        createElement(TerminalView, {
          id: "second",
          cwd: "/tmp",
          active: true,
        }),
      );
    });
    expect(pty.spawnPty).toHaveBeenCalledTimes(2);
    expect(pty.spawnPty).toHaveBeenLastCalledWith("second", "/tmp", 80, 24, undefined);
  } finally {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  }
});
