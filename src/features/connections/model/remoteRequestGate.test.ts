// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { saveRemoteAutoReconnect } from "../../settings/model/settings";
import { mayStartTunnel, remoteMachineFor, remoteRequest } from "./connections";
import { recordRemoteConnection, resetRemoteHealth } from "./remoteHealth";

const down = "Machine is unreachable. Check the host and SSH tunnel, then reconnect.";
const machine = {
  id: "m1",
  name: "Mini",
  endpoint: "",
  environmentId: "env",
  ssh: { target: "me@mini", remotePort: 3774 },
};

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
