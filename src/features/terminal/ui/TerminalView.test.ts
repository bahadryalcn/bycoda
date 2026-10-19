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
  instances: [] as Array<{
    options: { theme?: { foreground?: string; cursor?: string } };
    osc: Map<number, (data: string) => boolean>;
    dataHandler?: (data: string) => void;
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
