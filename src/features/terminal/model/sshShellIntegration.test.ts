// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  invoke: vi.fn(async () => "request-1"),
  listeners: [] as ((event: { payload: unknown }) => void)[],
  unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_: string, listener: (event: { payload: unknown }) => void) => {
    native.listeners.push(listener);
    return native.unlisten;
  }),
}));
import {
  useSshShellIntegration,
  validSshShellState,
  type SshShellController,
} from "./sshShellIntegration";
afterEach(() => {
  vi.clearAllMocks();
  native.listeners.length = 0;
  vi.unstubAllGlobals();
});
const snapshot = {
  id: "ssh-tab",
  status: "suggestions",
  shell: "bash",
  user: "alice",
  host: "remote-host",
  requestId: "request-1",
  prefix: "git st",
  cursor: 6,
  suggestions: ["git status"],
};

it("accepts only matching native terminal scope, end cursor and bounded safe candidate snapshots", () => {
  expect(validSshShellState(snapshot, "ssh-tab")).toBe(true);
  expect(validSshShellState({ ...snapshot, shell: "zsh" }, "ssh-tab")).toBe(true);
  expect(validSshShellState({ ...snapshot, shell: "powershell" }, "ssh-tab")).toBe(true);
  for (const bad of [
    { ...snapshot, id: "another-session" },
    { ...snapshot, cursor: 1 },
    { ...snapshot, user: "bad\nuser" },
    { ...snapshot, suggestions: ["sudo password"] },
    { ...snapshot, suggestions: ["git status\r"] },
    { ...snapshot, shell: "unknown" },
  ])
    expect(validSshShellState(bad, "ssh-tab")).toBe(false);
});

it("never mixes host/user sessions and accepts through native validation without PTY text replay", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let controller!: SshShellController;
  function Harness({ id }: { id: string }) {
    controller = useSshShellIntegration(id, true);
    return null;
  }
  try {
    await act(async () => root.render(createElement(Harness, { id: "ssh-tab" })));
    await act(async () => native.listeners.at(-1)!({ payload: { ...snapshot, id: "foreign" } }));
    expect(controller.state).toBeUndefined();
    await act(async () => controller.request());
    await act(async () => native.listeners.at(-1)!({ payload: snapshot }));
    expect(controller.state?.user).toBe("alice");
    expect(controller.state?.host).toBe("remote-host");
    await act(async () => controller.accept("git status"));
    expect(native.invoke).toHaveBeenCalledWith("ssh_terminal_suggestion_accept", {
      id: "ssh-tab",
      requestId: "request-1",
      value: "git status",
    });
    expect(native.invoke.mock.calls.some((call) => String(call[0]).includes("pty_write"))).toBe(
      false,
    );
    await act(async () => controller.invalidate());
    await expect(controller.accept("git status")).rejects.toThrow("stale");
    const oldListener = native.listeners.at(-1)!;
    await act(async () => root.render(createElement(Harness, { id: "new-session" })));
    await act(async () => oldListener({ payload: snapshot }));
    expect(controller.state).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("requests a snapshot only explicitly and never sends remote setup or commands on mount", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  let controller!: SshShellController;
  function Harness() {
    controller = useSshShellIntegration("ssh-tab", true);
    return null;
  }
  try {
    await act(async () => root.render(createElement(Harness)));
    expect(native.invoke).not.toHaveBeenCalled();
    await act(async () => controller.request());
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("ssh_terminal_suggestions_request", {
      id: "ssh-tab",
    });
    expect(controller.waiting).toBe(true);
    await act(async () =>
      native.listeners.at(-1)!({
        payload: { ...snapshot, status: "ready", suggestions: undefined, requestId: undefined },
      }),
    );
    expect(controller.waiting).toBe(true);
    await act(async () =>
      native.listeners.at(-1)!({
        payload: {
          ...snapshot,
          status: "unavailable",
          suggestions: undefined,
          requestId: undefined,
        },
      }),
    );
    expect(controller.waiting).toBe(false);
    expect(controller.error).toBe("No safe matching suggestions.");
    await act(async () => controller.dismiss());
    expect(controller.waiting).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("debounces zero-data edit notifications only after opt-in and structured prompt readiness", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  let controller!: SshShellController;
  function Harness({ id }: { id: string }) {
    controller = useSshShellIntegration(id, true);
    return null;
  }
  try {
    await act(async () => root.render(createElement(Harness, { id: "ssh-tab" })));
    await act(async () => {
      controller.notifyInput();
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(native.invoke).not.toHaveBeenCalled();
    await act(async () => controller.setAutomatic(true));
    await act(async () => {
      controller.notifyInput();
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(native.invoke).not.toHaveBeenCalled();
    await act(async () => native.listeners.at(-1)!({ payload: { ...snapshot, status: "ready" } }));
    await act(async () => {
      controller.invalidate();
      controller.notifyInput();
      await vi.advanceTimersByTimeAsync(150);
      controller.invalidate();
      controller.notifyInput();
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(native.invoke).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("ssh_terminal_suggestions_request", {
      id: "ssh-tab",
      source: "commands",
    });
    await act(async () => {
      controller.invalidate();
      controller.notifyInput();
      controller.suspendAutomatic();
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(native.invoke).toHaveBeenCalledTimes(1);
    await act(async () =>
      native.listeners.at(-1)!({ payload: { ...snapshot, status: "unavailable" } }),
    );
    await act(async () => {
      controller.notifyInput();
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(native.invoke).toHaveBeenCalledTimes(1);
    await act(async () =>
      native.listeners.at(-1)!({
        payload: { ...snapshot, status: "unavailable", promptReady: true },
      }),
    );
    await act(async () => {
      controller.notifyInput();
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(native.invoke).toHaveBeenCalledTimes(2);
    await act(async () =>
      native.listeners.at(-1)!({
        payload: { ...snapshot, status: "unavailable", promptReady: false },
      }),
    );
    await act(async () => {
      controller.notifyInput();
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(native.invoke).toHaveBeenCalledTimes(2);
    await act(async () => root.render(createElement(Harness, { id: "new-terminal" })));
    await act(async () => {
      controller.notifyInput();
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(native.invoke).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
  }
});

it("correlates early native replies to acknowledgements and rejects late replies after input", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  let controller!: SshShellController;
  function Harness() {
    controller = useSshShellIntegration("ssh-tab", true);
    return null;
  }
  let resolve!: (id: string) => void;
  native.invoke.mockImplementationOnce(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  try {
    await act(async () => root.render(createElement(Harness)));
    let request!: Promise<void>;
    await act(async () => {
      request = controller.request("paths");
    });
    await act(async () => native.listeners.at(-1)!({ payload: snapshot }));
    expect(controller.state?.status).not.toBe("suggestions");
    await act(async () => {
      resolve("request-1");
      await request;
    });
    expect(controller.state?.status).toBe("suggestions");
    await act(async () => controller.invalidate());
    await act(async () => native.listeners.at(-1)!({ payload: snapshot }));
    expect(controller.state).toBeUndefined();
    await expect(controller.accept("git status")).rejects.toThrow("stale");
  } finally {
    await act(async () => root.unmount());
  }
});

it("requires fresh exposure consent across terminal IDs and integration disable/re-enable boundaries", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"),
    root = createRoot(host);
  let controller!: SshShellController;
  function Harness({ id, enabled = true }: { id: string; enabled?: boolean }) {
    controller = useSshShellIntegration(id, enabled);
    return null;
  }
  const ready = async (id: string) =>
    act(async () => native.listeners.at(-1)!({ payload: { ...snapshot, id, status: "ready" } }));
  try {
    await act(async () => root.render(createElement(Harness, { id: "id-A" })));
    await act(async () => {
      controller.setSource("history");
      controller.setAutomatic(true);
    });
    expect(controller.source).toBe("history");
    expect(controller.automatic).toBe(true);
    await act(async () => root.render(createElement(Harness, { id: "id-B" })));
    expect(controller.source).toBe("commands");
    expect(controller.automatic).toBe(false);
    expect(controller.state).toBeUndefined();
    await ready("id-B");
    await act(async () => {
      controller.notifyInput();
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(native.invoke).not.toHaveBeenCalled();
    await act(async () => controller.setAutomatic(true));
    await act(async () => {
      controller.notifyInput();
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("ssh_terminal_suggestions_request", {
      id: "id-B",
      source: "commands",
    });
    await act(async () => root.render(createElement(Harness, { id: "id-B", enabled: false })));
    await act(async () => root.render(createElement(Harness, { id: "id-B", enabled: true })));
    expect(controller.automatic).toBe(false);
    expect(controller.source).toBe("commands");
    expect(controller.state).toBeUndefined();
    await ready("id-B");
    await act(async () => {
      controller.notifyInput();
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(native.invoke).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
  }
});

it("revokes history exposure on a known host/user transition but not unavailable or foreign notifications", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"),
    root = createRoot(host);
  let controller!: SshShellController;
  function Harness() {
    controller = useSshShellIntegration("ssh-tab", true);
    return null;
  }
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => native.listeners.at(-1)!({ payload: { ...snapshot, status: "ready" } }));
    await act(async () => {
      controller.setSource("history");
      controller.setAutomatic(true);
    });
    await act(async () =>
      native.listeners.at(-1)!({
        payload: { ...snapshot, status: "unavailable", user: "temporary-unknown", host: "unknown" },
      }),
    );
    expect(controller.automatic).toBe(true);
    expect(controller.source).toBe("history");
    await act(async () =>
      native.listeners.at(-1)!({
        payload: { ...snapshot, id: "foreign", status: "ready", user: "bob" },
      }),
    );
    expect(controller.automatic).toBe(true);
    await act(async () =>
      native.listeners.at(-1)!({ payload: { ...snapshot, status: "ready", user: "bob" } }),
    );
    expect(controller.automatic).toBe(false);
    expect(controller.source).toBe("commands");
    expect(controller.state?.user).toBe("bob");
    await act(async () => {
      controller.notifyInput();
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(native.invoke).not.toHaveBeenCalled();
    await act(async () => controller.setAutomatic(true));
    await act(async () =>
      native.listeners.at(-1)!({
        payload: { ...snapshot, status: "ready", user: "bob", host: "other-server" },
      }),
    );
    expect(controller.automatic).toBe(false);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
  }
});
