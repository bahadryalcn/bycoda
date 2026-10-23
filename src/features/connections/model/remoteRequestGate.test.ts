// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { saveRemoteAutoReconnect } from "../../settings/model/settings";
import {
  adoptRemoteMachineInventory,
  mayStartTunnel,
  remoteMachineFor,
  remoteRequest,
} from "./connections";
import {
  readRemoteLifecycle,
  pauseConnectionRecovery,
  beginConnectionAttempt,
  recordFeatureHealth,
} from "./remoteLifecycle";
import { recordRemoteConnection, resetRemoteHealth } from "./remoteHealth";

const down = "Machine is unreachable. Check the host and SSH tunnel, then reconnect.";
const machine = {
  id: "m1",
  name: "Mini",
  endpoint: "",
  environmentId: "env",
  ssh: { target: "me@mini", remotePort: 3774 },
};

it.each(["success", "failure"])(
  "rejects an old route's late %s without overwriting feature health",
  async (outcome) => {
    adoptRemoteMachineInventory([machine]);
    let finish!: (value: unknown) => void;
    let fail!: (reason: unknown) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
    );
    const old = remoteRequest("m1", "files.list");
    const rejected = expect(old).rejects.toThrow(
      "Connection changed while the request was running",
    );
    adoptRemoteMachineInventory([
      { ...machine, ssh: { ...machine.ssh, target: "me@replacement" } },
    ]);
    if (outcome === "success") finish({ old: true });
    else fail(new Error("Machine is unreachable"));
    await rejected;
    expect(readRemoteLifecycle("env").features.files).toBeUndefined();
  },
);

it("returns a host receipt even when the connection changed while it was in flight", async () => {
  adoptRemoteMachineInventory([machine]);
  let finish!: (value: unknown) => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const create = remoteRequest("m1", "commands.dispatch", { type: "create" });
  adoptRemoteMachineInventory([{ ...machine, ssh: { ...machine.ssh, target: "me@replacement" } }]);
  finish({ sessionId: "host-1", revision: 1 });
  await expect(create).resolves.toEqual({ sessionId: "host-1", revision: 1 });
});

it("still reports a dispatch that failed after the connection changed as superseded", async () => {
  adoptRemoteMachineInventory([machine]);
  let fail!: (reason: unknown) => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const create = remoteRequest("m1", "commands.dispatch", { type: "create" });
  const rejected = expect(create).rejects.toThrow(
    "Connection changed while the request was running",
  );
  adoptRemoteMachineInventory([{ ...machine, ssh: { ...machine.ssh, target: "me@replacement" } }]);
  fail(new Error("Machine is unreachable"));
  await rejected;
});

it("does not trust a receipt from a machine that is no longer the same environment", async () => {
  adoptRemoteMachineInventory([machine]);
  let finish!: (value: unknown) => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const create = remoteRequest("m1", "commands.dispatch", { type: "create" });
  const rejected = expect(create).rejects.toThrow(
    "Connection changed while the request was running",
  );
  adoptRemoteMachineInventory([{ ...machine, environmentId: "other-env" }]);
  finish({ sessionId: "host-1" });
  await rejected;
});

it("does not interrupt a valid request when many other peers report health", async () => {
  adoptRemoteMachineInventory([machine]);
  let finish!: (value: unknown) => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const old = remoteRequest("m1", "files.list");
  for (let index = 0; index < 129; index++) recordFeatureHealth(`peer-${index}`, "host", true);
  recordFeatureHealth("env", "host", true);
  finish({ current: true });
  await expect(old).resolves.toEqual({ current: true });
  expect(readRemoteLifecycle("env").features.files?.status).toBe("ready");
});

beforeEach(async () => {
  localStorage.clear();
  resetRemoteHealth();
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) =>
    command === "remote_machines" ? [machine] : {},
  );
  await remoteMachineFor("env"); // fills the machine list the gate reads
  invoke.mockClear();
});

const sent = () => invoke.mock.calls.find((call) => call[0] === "remote_request")?.[1];

describe("which requests may start an SSH tunnel", () => {
  it("does not let ordinary pollers restart a cancelled recovery", () => {
    pauseConnectionRecovery("env");
    expect(mayStartTunnel("m1", false, false)).toBe(false);
    expect(mayStartTunnel("m1", false, true)).toBe(true);
    beginConnectionAttempt("env");
    expect(mayStartTunnel("m1", false, false)).toBe(true);
  });
  it("allows everything while automatic reconnecting is on", async () => {
    recordRemoteConnection("env", down);
    await remoteRequest("m1", "sessions.list");
    expect(sent()).not.toHaveProperty("allowConnect");
  });

  it("stops background polls of a machine known to be down when it is off", async () => {
    saveRemoteAutoReconnect(false);
    recordRemoteConnection("env", down);
    await remoteRequest("m1", "sessions.list");
    expect(sent()).toMatchObject({ allowConnect: false });
  });

  it("lets what the user did connect, and a machine not known to be down", async () => {
    saveRemoteAutoReconnect(false);
    recordRemoteConnection("env", down);
    expect(mayStartTunnel("m1", true, false)).toBe(true); // Reconnect
    expect(mayStartTunnel("m1", false, true)).toBe(true); // Send, open a project
    resetRemoteHealth(); // nothing has failed yet, as at startup
    expect(mayStartTunnel("m1", false, false)).toBe(true);
    recordRemoteConnection("env");
    expect(mayStartTunnel("m1", false, false)).toBe(true);
  });

  it("treats a machine waiting for sign-in like one that is down", () => {
    saveRemoteAutoReconnect(false);
    recordRemoteConnection("env", "SSH connection failed: Permission denied (publickey).");
    expect(mayStartTunnel("m1", false, false)).toBe(false);
  });
});
