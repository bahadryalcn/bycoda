// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const pty = vi.hoisted(() => ({
  spawnPty: vi.fn(async () => {}),
  readyPtyBridge: vi.fn(async () => {}),
  killPty: vi.fn(async () => {}),
  resizePty: vi.fn(async () => {}),
  writePty: vi.fn(async () => {}),
  subscribePty: vi.fn(() => () => {}),
  getPtyStatus: vi.fn(async () => ({ foreground: null })),
  setPtyVisible: vi.fn(async () => {}),
}));
const native = vi.hoisted(() => ({ invoke: vi.fn(async () => {}) }));
const assistance = vi.hoisted(() => ({
  state: undefined as import("../model/sshShellIntegration").SshShellState | undefined,
  waiting: false,
  error: "",
  automatic: false,
  source: "commands" as const,
  request: vi.fn(async () => {}),
  dismiss: vi.fn(),
  accept: vi.fn(async () => {}),
  invalidate: vi.fn(),
  notifyInput: vi.fn(),
  suspendAutomatic: vi.fn(),
  setAutomatic: vi.fn(),
  setSource: vi.fn(),
}));
vi.mock("../model/sshShellIntegration", () => ({ useSshShellIntegration: () => assistance }));
vi.mock("@tauri-apps/api/core", () => native);
const xterm = vi.hoisted(() => ({
  fit: vi.fn(() => null as { cols: number; rows: number } | null),
  writes: vi.fn((callback?: () => void) => callback?.()),
  webgl: [] as Array<{ dispose: ReturnType<typeof vi.fn> }>,
  instances: [] as Array<{
    options: { theme?: { foreground?: string; cursor?: string } };
    osc: Map<number, (data: string) => boolean>;
    dataHandler?: (data: string) => void;
    write: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
  }>,
}));
vi.mock("../../../platform/tauri/pty", () => pty);
vi.mock("../model/terminalLayout", () => ({
  fitTerminal: xterm.fit,
  applyTerminalChrome: () => {},
  resetGridStretch: () => {},
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    dispose = vi.fn();
    constructor() {
      xterm.webgl.push(this);
    }
    activate() {}
    onContextLoss() {
      return { dispose() {} };
    }
  },
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = {};
    osc = new Map<number, (data: string) => boolean>();
    dataHandler?: (data: string) => void;
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
    write = vi.fn((_data: string | Uint8Array, callback?: () => void) => xterm.writes(callback));
    refresh = vi.fn();
    onData(handler: (data: string) => void) {
      this.dataHandler = handler;
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
import { takeTerminalCommand } from "../model/terminalLaunchCommand";
import {
  APPEARANCE_DEFAULTS,
  saveAppearancePreferences,
} from "../../settings/model/appearancePreferences";

it("zooms only the hovered terminal, clamps size and applies saved typography without respawning", async () => {
  localStorage.clear();
  const { host, root } = setup();
  try {
    await act(async () =>
      root.render(
        createElement(
          "div",
          null,
          createElement(TerminalView, { id: "zoom-first", cwd: "", active: true }),
          createElement(TerminalView, { id: "zoom-second", cwd: "", active: true }),
        ),
      ),
    );
    const first = xterm.instances[0];
    const second = xterm.instances[1];
    const pane = host.querySelector(".bycoda-terminal-host")!;
    const wheel = (ctrlKey: boolean, deltaY: number) => {
      const event = new WheelEvent("wheel", { ctrlKey, deltaY, bubbles: true, cancelable: true });
      // happy-dom's WheelEvent does not copy modifier keys from its init dictionary.
      Object.defineProperty(event, "ctrlKey", { value: ctrlKey });
      pane.dispatchEvent(event);
      return event;
    };
    expect(wheel(false, -100).defaultPrevented).toBe(false);
    expect(wheel(true, -100).defaultPrevented).toBe(true);
    expect(first.options).toMatchObject({ fontSize: 14 });
    expect(second.options).toMatchObject({ fontSize: 13 });
    expect(wheel(true, 0).defaultPrevented).toBe(false);
    for (let i = 0; i < 60; i++) wheel(true, 100);
    expect(first.options).toMatchObject({ fontSize: 8 });
    for (let i = 0; i < 60; i++) wheel(true, -100);
    expect(first.options).toMatchObject({ fontSize: 40 });
    await act(async () =>
      saveAppearancePreferences({
        ...APPEARANCE_DEFAULTS,
        codeSize: 18,
        terminalSize: 20,
        terminalWeight: 600,
        terminalFont: "JetBrains Mono",
        terminalLineHeight: 1.35,
      }),
    );
    for (const instance of [first, second])
      expect(instance.options).toMatchObject({
        fontSize: 20,
        fontWeight: 600,
        fontFamily: '"JetBrains Mono", monospace',
        lineHeight: 1.35,
      });
    expect(pty.spawnPty).toHaveBeenCalledTimes(2);
    expect(pty.killPty).not.toHaveBeenCalled();
    expect(xterm.instances).toHaveLength(2);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    localStorage.clear();
  }
});

it("refuses a reviewed SSH spawn after source privacy changes across bridge readiness", async () => {
  const { host, root } = setup();
  let release!: () => void,
    allowed = true;
  pty.readyPtyBridge.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const lifecycle = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(TerminalView, {
          id: "mobile-source-guard",
          cwd: "",
          sshConnectionId: "saved",
          active: true,
          canStart: () => allowed,
          onLifecycle: lifecycle,
        }),
      ),
    );
    allowed = false;
    await act(async () => release());
    expect(native.invoke.mock.calls.some(([command]) => command === "ssh_terminal_spawn")).toBe(
      false,
    );
    expect(lifecycle).toHaveBeenCalledWith("failed");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("checks live pending authority after bridge readiness and refuses a revoked SSH spawn", async () => {
  const { host, root } = setup();
  let release!: () => void;
  pty.readyPtyBridge.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  let authorized = true;
  const authorizeStart = vi.fn(async () => authorized),
    lifecycle = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(TerminalView, {
          id: "mobile-pending-authority",
          cwd: "",
          sshConnectionId: "saved",
          active: true,
          canStart: () => true,
          authorizeStart,
          onLifecycle: lifecycle,
        }),
      ),
    );
    authorized = false;
    await act(async () => release());
    expect(authorizeStart).toHaveBeenCalledTimes(1);
    expect(native.invoke.mock.calls.some(([command]) => command === "ssh_terminal_spawn")).toBe(
      false,
    );
    expect(lifecycle).toHaveBeenCalledWith("failed");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("reports terminal closure only after its own canonical PTY cleanup completes", async () => {
  const { host, root } = setup();
  let finish!: () => void;
  pty.killPty.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const lifecycle = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(TerminalView, {
          id: "mobile-close-proof",
          cwd: "",
          sshConnectionId: "saved",
          active: true,
          onLifecycle: lifecycle,
        }),
      ),
    );
    expect(lifecycle).toHaveBeenCalledWith("opened-on-computer");
    await act(async () => root.unmount());
    expect(lifecycle).not.toHaveBeenCalledWith("closed");
    await act(async () => finish());
    expect(lifecycle).toHaveBeenCalledWith("closed");
    expect(pty.killPty).toHaveBeenCalledWith("mobile-close-proof");
  } finally {
    host.remove();
  }
});

it("changes server typography without replacing or restarting its SSH process", async () => {
  const { host, root } = setup();
  const render = (fontSize: number) =>
    createElement(TerminalView, {
      id: "ssh-typography",
      cwd: "",
      sshConnectionId: "saved",
      active: true,
      fontSize,
      lineHeight: 1.35,
    });
  try {
    await act(async () => root.render(render(15)));
    const instance = xterm.instances[0];
    expect(instance.options).toMatchObject({
      fontSize: 15,
      lineHeight: 1.35,
      minimumContrastRatio: 4.5,
    });
    expect(instance.options).toHaveProperty(
      "theme.background",
      expect.not.stringMatching(/^(#00000000|transparent)$/),
    );
    await act(async () => root.render(render(20)));
    expect(xterm.instances).toHaveLength(1);
    expect(instance.options).toMatchObject({ fontSize: 20, lineHeight: 1.35 });
    expect(
      native.invoke.mock.calls.filter(([command]) => command === "ssh_terminal_spawn"),
    ).toHaveLength(1);
    expect(pty.killPty).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("opens opt-in integration through a new-tab callback without injecting into the current shell", async () => {
  const { host, root } = setup();
  const openIntegrated = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(TerminalView, {
          id: "opt-in-raw",
          cwd: "",
          sshConnectionId: "saved",
          active: true,
          onEnableShellIntegration: openIntegrated,
        }),
      ),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Terminal · More actions"]')!.click(),
    );
    const button = Array.from(document.querySelectorAll("button")).find((element) =>
      element.textContent?.startsWith("Bash suggestions"),
    )!;
    await act(async () => button.click());
    expect(openIntegrated).toHaveBeenCalledTimes(1);
    expect(pty.writePty).not.toHaveBeenCalled();
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("ssh_terminal_spawn", {
      id: "opt-in-raw",
      connectionId: "saved",
      cols: 80,
      rows: 24,
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("quick SSH passes its explicit one-use approval without a saved record or local launch replay", async () => {
  const { host, root } = setup();
  const endpoint = { host: "quick.test", user: "alice", port: 2222 };
  queueTerminalCommand("quick-ssh", "do-not-replay");
  try {
    await act(async () =>
      root.render(
        createElement(TerminalView, {
          id: "quick-ssh",
          cwd: "C:/local",
          sshEndpoint: endpoint,
          agentForwardingReviewId: "one-use-native-review",
          httpProxyTicketId: "one-use-proxy-ticket",
          active: true,
        }),
      ),
    );
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("ssh_terminal_quick_spawn", {
      id: "quick-ssh",
      endpoint,
      agentForwardingReviewId: "one-use-native-review",
      httpProxyTicketId: "one-use-proxy-ticket",
      cols: 80,
      rows: 24,
    });
    expect(pty.spawnPty).not.toHaveBeenCalled();
    expect(pty.writePty).not.toHaveBeenCalled();
    expect(takeTerminalCommand("quick-ssh")).toBe("do-not-replay");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("starts SSH without local profile, command replay, local metadata or template suggestions", async () => {
  const { host, root } = setup();
  const onMetaChange = vi.fn();
  queueTerminalCommand("ssh-only", "never-run-this");
  try {
    await act(async () =>
      root.render(
        createElement(TerminalView, {
          id: "ssh-only",
          cwd: "C:/local-only",
          profile: "local-profile",
          sshConnectionId: "saved-server",
          active: true,
          onMetaChange,
        }),
      ),
    );
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("ssh_terminal_spawn", {
      id: "ssh-only",
      connectionId: "saved-server",
      cols: 80,
      rows: 24,
    });
    expect(pty.spawnPty).not.toHaveBeenCalled();
    expect(pty.writePty).not.toHaveBeenCalled();
    expect(pty.getPtyStatus).not.toHaveBeenCalled();
    xterm.instances[0].osc.get(7)?.("file://remote/home/remote-user");
    expect(onMetaChange).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="Command suggestions"]')).toBeNull();
    expect(takeTerminalCommand("ssh-only")).toBe("never-run-this");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("passes remote history/completion, multiline, Unicode, paste and interrupt bytes through unchanged", async () => {
  const { host, root } = setup();
  try {
    await act(async () =>
      root.render(
        createElement(TerminalView, {
          id: "ssh-raw",
          cwd: "",
          sshConnectionId: "saved",
          active: true,
        }),
      ),
    );
    const sequences = [
      "\x1b[A",
      "\x1b[B",
      "\t",
      "\x12",
      "\x03",
      "echo Türkçe 日本語",
      "\x1b[200~first\nsecond\x1b[201~",
    ];
    for (const data of sequences) {
      await act(async () => xterm.instances[0].dataHandler?.(data));
      expect(pty.writePty).toHaveBeenLastCalledWith("ssh-raw", data);
    }
    expect(pty.writePty).toHaveBeenCalledTimes(sequences.length);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

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
  assistance.state = undefined;
  xterm.instances.length = 0;
  xterm.webgl.length = 0;
  xterm.fit.mockReset().mockReturnValue(null);
  xterm.writes.mockReset().mockImplementation((callback) => callback?.());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("signals startup review only once after the native ready prompt for this integrated terminal", async () => {
  const { host, root } = setup();
  const ready = vi.fn();
  const render = (integrated = true) =>
    root.render(
      createElement(TerminalView, {
        id: "trusted-ready",
        cwd: "",
        sshConnectionId: "saved",
        active: true,
        shellIntegration: integrated ? "bash" : undefined,
        onSshPromptReady: ready,
      }),
    );
  try {
    await act(async () => render());
    expect(ready).not.toHaveBeenCalled();
    assistance.state = { id: "another-terminal", status: "ready" } as typeof assistance.state;
    await act(async () => render());
    expect(ready).not.toHaveBeenCalled();
    assistance.state = { id: "trusted-ready", status: "unavailable" } as typeof assistance.state;
    await act(async () => render());
    expect(ready).not.toHaveBeenCalled();
    assistance.state = {
      id: "trusted-ready",
      status: "ready",
      promptReady: false,
    } as typeof assistance.state;
    await act(async () => render());
    expect(ready).not.toHaveBeenCalled();
    assistance.state = {
      id: "trusted-ready",
      status: "ready",
      promptReady: true,
    } as typeof assistance.state;
    await act(async () => render(false));
    expect(ready).not.toHaveBeenCalled();
    await act(async () => render());
    expect(ready).toHaveBeenCalledTimes(1);
    assistance.state = { ...assistance.state!, status: "unavailable" };
    await act(async () => render());
    assistance.state = { ...assistance.state!, status: "ready" };
    await act(async () => render());
    expect(ready).toHaveBeenCalledTimes(1);
    expect(pty.writePty).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("resolves scoped theme colors for xterm and six-digit OSC replies", async () => {
  // No visibility signal: the terminal counts as on screen, so theme changes apply.
  vi.stubGlobal("IntersectionObserver", undefined);
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
          active: false,
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
    await act(async () => {
      document.documentElement.style.setProperty("--terminal-test-theme", "updated");
      // Root mutations are coalesced to one palette probe per frame.
      await Promise.resolve();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
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

it("fits before replaying hidden output and redraws on return even at the same size", async () => {
  const { host, root } = setup();
  let intersect!: (entries: { isIntersecting: boolean }[]) => void;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof intersect) {
        intersect = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const events: string[] = [];
  xterm.fit.mockImplementation(() => {
    events.push("fit");
    return { cols: 80, rows: 24 };
  });
  try {
    await act(async () =>
      root.render(
        createElement(TerminalView, {
          id: "visibility-replay",
          cwd: "",
          active: false,
        }),
      ),
    );
    const term = xterm.instances[0];
    const receive = (
      pty.subscribePty.mock.calls as unknown as Array<[string, (data: string) => void]>
    )[0][1];
    term.write.mockImplementation((data, callback) => {
      events.push(data ? `write:${data}` : "drain");
      callback?.();
    });
    await act(async () => intersect([{ isIntersecting: true }]));
    expect(xterm.webgl).toHaveLength(1);
    const firstRenderer = xterm.webgl[0];
    expect(pty.setPtyVisible).toHaveBeenLastCalledWith("visibility-replay", true);
    await act(async () => intersect([{ isIntersecting: false }]));
    expect(firstRenderer.dispose).toHaveBeenCalledOnce();
    // The native side holds output while the terminal is off screen.
    expect(pty.setPtyVisible).toHaveBeenLastCalledWith("visibility-replay", false);
    term.write.mockClear();
    receive("background output");
    expect(term.write).not.toHaveBeenCalled();
    events.length = 0;
    term.refresh.mockClear();
    pty.resizePty.mockClear();
    await act(async () => intersect([{ isIntersecting: true }]));
    expect(events.slice(0, 4)).toEqual(["fit", "write:background output", "drain", "fit"]);
    expect(pty.setPtyVisible).toHaveBeenLastCalledWith("visibility-replay", true);
    expect(term.refresh).toHaveBeenCalledWith(0, 23);
    expect(xterm.webgl).toHaveLength(2);
    expect(pty.resizePty).not.toHaveBeenCalled();
    expect(pty.spawnPty).toHaveBeenCalledOnce();
    expect(pty.killPty).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("ignores a stale output drain after hiding and restores a visible window without resizing", async () => {
  const { host, root } = setup();
  vi.stubGlobal("IntersectionObserver", undefined);
  let hidden = false;
  const hiddenSpy = vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  const drains: (() => void)[] = [];
  xterm.writes.mockImplementation((callback) => {
    if (callback) drains.push(callback);
  });
  try {
    await act(async () =>
      root.render(
        createElement(TerminalView, {
          id: "window-restore",
          cwd: "",
          active: false,
        }),
      ),
    );
    const term = xterm.instances[0];
    hidden = true;
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => drains.shift()!());
    expect(term.refresh).not.toHaveBeenCalled();
    expect(xterm.webgl).toHaveLength(0);
    hidden = false;
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(term.refresh).not.toHaveBeenCalled();
    await act(async () => drains.shift()!());
    expect(term.refresh).toHaveBeenCalledWith(0, 23);
    expect(xterm.webgl).toHaveLength(1);
    hidden = true;
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(xterm.webgl[0].dispose).toHaveBeenCalledOnce();
    hidden = false;
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => root.unmount());
    term.refresh.mockClear();
    await act(async () => drains.shift()!());
    expect(term.refresh).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    hiddenSpy.mockRestore();
    host.remove();
  }
});

it("shows the native exit status and returns to servers without offering input resume or spawning again", async () => {
  const { host, root } = setup();
  const back = vi.fn();
  let exit!: (code: number | null) => void;
  pty.subscribePty.mockImplementationOnce((...args: unknown[]) => {
    exit = args[2] as (code: number | null) => void;
    return () => {};
  });
  try {
    await act(async () =>
      root.render(
        createElement(TerminalView, {
          id: "closed-ssh",
          cwd: "",
          active: true,
          sshConnectionId: "server",
          onReturnToServers: back,
        }),
      ),
    );
    await act(async () => exit(255));
    expect(assistance.suspendAutomatic).toHaveBeenCalled();
    await act(async () => xterm.instances.at(-1)!.dataHandler!("must-not-replay\r"));
    expect(pty.writePty).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Terminal closed");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("255");
    expect(
      [...host.querySelectorAll("button")].some((button) =>
        button.textContent?.includes("Resume input"),
      ),
    ).toBe(false);
    const calls = native.invoke.mock.calls.length;
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Back to servers")!
        .click(),
    );
    expect(back).toHaveBeenCalledOnce();
    expect(native.invoke.mock.calls).toHaveLength(calls);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("reconnects closed SSH only explicitly and prevents duplicate requests or input replay", async () => {
  const { host, root } = setup();
  let exit!: (code: number | null) => void;
  let finish!: () => void;
  const reconnect = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  pty.subscribePty.mockImplementationOnce((...args: unknown[]) => {
    exit = args[2] as typeof exit;
    return () => {};
  });
  try {
    await act(async () =>
      root.render(
        createElement(TerminalView, {
          id: "explicit-reconnect",
          cwd: "",
          active: true,
          sshConnectionId: "server",
          onReconnect: reconnect,
        }),
      ),
    );
    await act(async () => exit(255));
    expect(reconnect).not.toHaveBeenCalled();
    const button = [...host.querySelectorAll("button")].find(
      (item) => item.textContent === "Reconnect",
    )!;
    await act(async () => {
      button.click();
      button.click();
    });
    expect(reconnect).toHaveBeenCalledOnce();
    await act(async () => xterm.instances.at(-1)!.dataHandler!("old-command\r"));
    expect(pty.writePty).not.toHaveBeenCalled();
    await act(async () => finish());
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("shows failed SSH startup as a closed terminal and discards pending input", async () => {
  const { host, root } = setup();
  native.invoke.mockRejectedValueOnce(new Error("SSH authentication failed"));
  try {
    await act(async () =>
      root.render(
        createElement(TerminalView, {
          id: "failed-start",
          cwd: "",
          active: true,
          sshConnectionId: "server",
        }),
      ),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Terminal closed");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "SSH authentication failed",
    );
    await act(async () => xterm.instances.at(-1)!.dataHandler!("late\r"));
    expect(pty.writePty).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it.each(["terminal input is backed up", "disconnected"])(
  "shows %s and resumes only fresh input",
  async (message) => {
    const { host, root } = setup();
    pty.writePty.mockRejectedValueOnce(new Error(message));
    try {
      await act(async () =>
        root.render(
          createElement(TerminalView, { id: `failure-${message}`, cwd: "/repo", active: true }),
        ),
      );
      const edit = xterm.instances.at(-1)!.dataHandler!;
      await act(async () => {
        edit("npm test");
        edit("\r");
      });
      expect(pty.writePty).toHaveBeenCalledExactlyOnceWith(`failure-${message}`, "npm test");
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(message);
      await act(async () => edit("discarded\r"));
      expect(pty.writePty).toHaveBeenCalledTimes(1);
      const resume = Array.from(host.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Resume input"),
      )!;
      await act(async () => resume.click());
      expect(host.querySelector('[role="alert"]')).toBeNull();
      await act(async () => edit("fresh"));
      expect(pty.writePty.mock.calls.map((call) => call[1])).toEqual(["npm test", "fresh"]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  },
);

it("waits for global event readiness before direct SSH spawn", async () => {
  const { host, root } = setup();
  let ready!: () => void;
  pty.readyPtyBridge.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        ready = resolve;
      }),
  );
  try {
    await act(async () =>
      root.render(
        createElement(TerminalView, {
          id: "ssh-readiness",
          cwd: "",
          sshConnectionId: "saved",
          active: true,
        }),
      ),
    );
    expect(native.invoke).not.toHaveBeenCalled();
    await act(async () => ready());
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("ssh_terminal_spawn", {
      id: "ssh-readiness",
      connectionId: "saved",
      cols: 80,
      rows: 24,
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("notifies autocomplete only after the latest visible non-composing SSH edit is written", async () => {
  const { host, root } = setup();
  vi.stubGlobal("IntersectionObserver", undefined);
  const render = (active = true) =>
    root.render(
      createElement(TerminalView, {
        id: "auto-ssh",
        cwd: "",
        active,
        sshConnectionId: "saved-server",
        shellIntegration: "bash",
      }),
    );
  const writes: (() => void)[] = [];
  pty.writePty
    .mockImplementationOnce(() => new Promise<void>((resolve) => writes.push(resolve)))
    .mockImplementationOnce(() => new Promise<void>((resolve) => writes.push(resolve)));
  try {
    await act(async () => render());
    const edit = xterm.instances.at(-1)!.dataHandler!;
    await act(async () => {
      edit("a");
      edit("b");
    });
    expect(assistance.notifyInput).not.toHaveBeenCalled();
    await act(async () => writes[0]());
    expect(assistance.notifyInput).not.toHaveBeenCalled();
    await act(async () => writes[1]());
    expect(assistance.notifyInput).toHaveBeenCalledExactlyOnceWith();
    await act(async () => {
      edit("\x1b[A");
      edit("\t");
      edit("\x12");
    });
    expect(assistance.notifyInput).toHaveBeenCalledTimes(1);
    await act(async () => render(false));
    await act(async () => edit("c"));
    expect(assistance.notifyInput).toHaveBeenCalledTimes(1);
    await act(async () => render(true));
    const terminalHost = host.querySelector(".bycoda-terminal-host")!;
    // Composition bubbles from xterm's textarea into its containing host.
    await act(async () =>
      terminalHost.dispatchEvent(new Event("compositionstart", { bubbles: true })),
    );
    await act(async () => edit("composed"));
    expect(assistance.notifyInput).toHaveBeenCalledTimes(1);
    expect(pty.writePty.mock.calls.map((call) => call[1])).toEqual([
      "a",
      "b",
      "\x1b[A",
      "\t",
      "\x12",
      "c",
      "composed",
    ]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

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
