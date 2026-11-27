// @vitest-environment happy-dom
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "window-a" }),
}));
import { listen } from "@tauri-apps/api/event";
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
    expect(controller.notice).toBe("No safe matching suggestions.");
    await act(async () => controller.dismiss());
    expect(controller.waiting).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

const catalog = (kind: "history" | "commands", suggestions: string[], extra = {}) => ({
  ...snapshot,
  status: "catalog",
  catalog: kind,
  suggestions,
  requestId: undefined,
  prefix: undefined,
  cursor: undefined,
  ...extra,
});

it("validates prompt catalogs as bounded literal command lines", () => {
  expect(validSshShellState(catalog("history", ["git status", "ls -la /var/log"]), "ssh-tab")).toBe(
    true,
  );
  for (const bad of [
    catalog("history", ["ls; rm -rf /"]),
    catalog("history", ["echo $(id)"]),
    catalog("history", [" leading space"]),
    catalog("history", ["-flag"]),
    catalog("history", ["line\nbreak"]),
    { ...catalog("history", []), catalog: "paths" },
    catalog(
      "commands",
      Array.from({ length: 4001 }, (_, index) => `cmd${index}`),
    ),
  ])
    expect(validSshShellState(bad, "ssh-tab")).toBe(false);
});

it("filters the prompt catalog locally per keystroke and never writes to the shell while typing", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  let controller!: SshShellController;
  function Harness({ id }: { id: string }) {
    controller = useSshShellIntegration(id, true);
    return null;
  }
  const emit = (payload: unknown) => act(async () => native.listeners.at(-1)!({ payload }));
  try {
    await act(async () => root.render(createElement(Harness, { id: "ssh-tab" })));
    expect(controller.automatic).toBe(true);
    // A catalog before a verified prompt, or from another account, is ignored.
    await emit(catalog("history", ["git status"]));
    await emit({ ...snapshot, status: "ready", promptReady: true });
    await emit(catalog("history", ["git status"], { user: "mallory" }));
    expect(controller.catalogMatches("git st")).toEqual([]);
    await emit(catalog("history", ["git stash list", "git status", "ls -la"]));
    await emit(catalog("commands", ["git status", "git", "gitk", "ls"]));
    expect(controller.promptReady).toBe(true);
    for (const prefix of ["g", "gi", "git", "git ", "git s", "git st"]) {
      await act(async () => controller.invalidate(true));
      expect(controller.catalogMatches(prefix).length).toBeGreaterThan(0);
    }
    // History first (newest first), then command forms and names; never the typed text itself.
    expect(controller.catalogMatches("git")).toEqual(["git stash list", "git status", "gitk"]);
    expect(controller.catalogMatches("git st")).toEqual(["git stash list", "git status"]);
    expect(controller.catalogMatches("ls; rm")).toEqual([]);
    expect(native.invoke).not.toHaveBeenCalled();

    await act(async () => controller.setSource("history"));
    expect(controller.catalogMatches("g")).toEqual(["git stash list", "git status"]);
    await act(async () => controller.setSource("paths"));
    expect(controller.catalogMatches("g")).toEqual([]);
    await act(async () => controller.setSource("commands"));

    const epoch = controller.previewEpoch;
    await act(async () => controller.acceptCatalog("git st", "git status"));
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("ssh_terminal_catalog_accept", {
      id: "ssh-tab",
      prefix: "git st",
      value: "git status",
    });
    expect(controller.previewEpoch).toBeGreaterThan(epoch);

    // A submitted line or busy shell revokes the prompt capability until the next prompt.
    await emit({ ...snapshot, status: "unavailable", promptReady: false });
    expect(controller.catalogMatches("git")).toEqual([]);
    await emit({ ...snapshot, status: "ready", promptReady: true });
    expect(controller.catalogMatches("git st")).toEqual(["git stash list", "git status"]);
    await act(async () => controller.setAutomatic(false));
    expect(controller.catalogMatches("git st")).toEqual([]);
  } finally {
    await act(async () => root.unmount());
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

it("resets to automatic command suggestions across terminal IDs and requires fresh prompt readiness", async () => {
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
    act(async () =>
      native.listeners.at(-1)!({
        payload: { ...snapshot, id, status: "ready", promptReady: true },
      }),
    );
  const history = async (id: string) =>
    act(async () =>
      native.listeners.at(-1)!({ payload: { ...catalog("history", ["git status"]), id } }),
    );
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
    expect(controller.automatic).toBe(true);
    expect(controller.state).toBeUndefined();
    expect(controller.promptReady).toBe(false);
    await history("id-B");
    expect(controller.catalogMatches("git")).toEqual([]);
    await ready("id-B");
    await history("id-B");
    expect(controller.catalogMatches("git")).toEqual(["git status"]);
    await act(async () => root.render(createElement(Harness, { id: "id-B", enabled: false })));
    await act(async () => root.render(createElement(Harness, { id: "id-B", enabled: true })));
    expect(controller.automatic).toBe(true);
    expect(controller.source).toBe("commands");
    expect(controller.state).toBeUndefined();
    // The previous session's catalog and prompt capability are never inherited.
    expect(controller.promptReady).toBe(false);
    expect(controller.catalogMatches("git")).toEqual([]);
    await ready("id-B");
    expect(controller.catalogMatches("git")).toEqual([]);
    expect(native.invoke).not.toHaveBeenCalled();
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
    await act(async () =>
      native.listeners.at(-1)!({ payload: { ...snapshot, status: "ready", promptReady: true } }),
    );
    await act(async () =>
      native.listeners.at(-1)!({ payload: catalog("history", ["git status"]) }),
    );
    expect(controller.catalogMatches("git")).toEqual(["git status"]);
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
    // Alice's history never completes Bob's prompt, even once suggestions are re-enabled.
    await act(async () => controller.setAutomatic(true));
    expect(controller.catalogMatches("git")).toEqual([]);
    await act(async () => controller.setAutomatic(false));
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

it("ends an explicit snapshot on typed input and closes the passive list only on control input", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let controller!: SshShellController;
  function Harness() {
    controller = useSshShellIntegration("ssh-tab", true);
    return null;
  }
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => controller.request());
    await act(async () => native.listeners.at(-1)!({ payload: snapshot }));
    const epoch = controller.previewEpoch;
    await act(async () => controller.invalidate(true));
    expect(controller.state).toBeUndefined();
    await expect(controller.accept("git status")).rejects.toThrow(/stale/);
    expect(controller.previewEpoch).toBe(epoch);
    await act(async () => controller.invalidate(false));
    expect(controller.previewEpoch).toBeGreaterThan(epoch);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("shares one window-targeted listener and routes terminal IDs independently", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  let first!: SshShellController;
  let second!: SshShellController;
  function Fixture({ showSecond }: { showSecond: boolean }) {
    first = useSshShellIntegration("first", true);
    return showSecond ? createElement(Other) : null;
  }
  function Other() {
    second = useSshShellIntegration("second", true);
    return null;
  }
  await act(async () => root.render(createElement(Fixture, { showSecond: true })));
  expect(listen).toHaveBeenCalledTimes(1);
  expect(listen).toHaveBeenCalledWith("ssh-shell-state", expect.any(Function), {
    target: "window-a",
  });
  await act(async () =>
    native.listeners[0]({ payload: { ...snapshot, id: "second", status: "ready" } }),
  );
  expect(first.state).toBeUndefined();
  expect(second.state?.id).toBe("second");
  await act(async () => root.render(createElement(Fixture, { showSecond: false })));
  expect(native.unlisten).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  expect(native.unlisten).toHaveBeenCalledOnce();
});

it("reports failed registration and retries before requesting suggestions", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(listen).mockRejectedValueOnce(new Error("listener unavailable"));
  const root = createRoot(document.createElement("div"));
  let controller!: SshShellController;
  function Fixture() {
    controller = useSshShellIntegration("retry", true);
    return null;
  }
  await act(async () => root.render(createElement(Fixture)));
  expect(controller.notice).toBe("Remote shell integration is unavailable");
  expect(native.invoke).not.toHaveBeenCalled();
  await act(async () => controller.request());
  expect(listen).toHaveBeenCalledTimes(2);
  expect(native.invoke).toHaveBeenCalledWith("ssh_terminal_suggestions_request", { id: "retry" });
  await act(async () => root.unmount());
});

it("cleans up a registration that resolves after the final terminal unmounts", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resolve!: (stop: () => void) => void;
  vi.mocked(listen).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const root = createRoot(document.createElement("div"));
  function Fixture() {
    useSshShellIntegration("early", true);
    return null;
  }
  await act(async () => root.render(createElement(Fixture)));
  await act(async () => root.unmount());
  await act(async () => {
    resolve(native.unlisten);
  });
  expect(native.unlisten).toHaveBeenCalledOnce();
});
