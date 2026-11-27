import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { machineCapabilities } from "../../automations/public/hostMachines";
import {
  chooseSettingsHost,
  enabledRemotes,
  loadSettingsHosts,
  probeSettingsHost,
  settingsHostEntries,
  settingsHostOptions,
  settingsHostStatus,
  settingsHostUnavailableMessage,
} from "./settingsHosts";
import type { RemoteMachine } from "./protocol";
import type { RemoteConnectionState } from "./remoteConnection";
import { applyRemoteConnection, readRemoteConnection, resetRemoteHealth } from "./remoteHealth";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../automations/public/hostMachines", () => ({ machineCapabilities: vi.fn() }));

const machine = (id: string, extra: Partial<RemoteMachine> = {}): RemoteMachine => ({
  id,
  name: id,
  endpoint: `https://${id}.example`,
  environmentId: `env-${id}`,
  ...extra,
});
const local = machine("local", { localHost: true, endpoint: "http://127.0.0.1:7777" });
const refusal = "Host rejected request [RPC_AUTHORIZATION] (environment.describe)";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(machineCapabilities).mockReset();
  resetRemoteHealth();
});
afterEach(() => resetRemoteHealth());

const fail = (environmentId: string, error: string) =>
  applyRemoteConnection(environmentId, { type: "failure", error, at: 1 });

it("lists enabled saved machines without asking any of them", async () => {
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "local_host_connect" ? local : [local, machine("up"), machine("off")],
  );
  const hosts = await loadSettingsHosts();
  expect(machineCapabilities).not.toHaveBeenCalled();
  expect(enabledRemotes([machine("up"), machine("off")], (id) => id !== "env-off")).toEqual([
    machine("up"),
  ]);
  expect(hosts.local?.id).toBe("local");
  // The local sync record is this computer, never a second machine.
  expect(hosts.remotes.map((entry) => entry.id)).toEqual(["up", "off"]);
});

it("keeps a failing this-computer Host from breaking the list of other machines", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "local_host_connect") throw new Error(refusal);
    return [machine("up")];
  });
  const hosts = await loadSettingsHosts();
  expect(hosts.local).toBeUndefined();
  expect(hosts.localError).toContain("RPC_AUTHORIZATION");
  const entries = settingsHostEntries(hosts);
  expect(entries.map((entry) => [entry.isLocal, entry.status])).toEqual([
    [true, "offline"],
    [false, "checking"],
  ]);
});

it("shows each machine's state from the live store, this computer first", () => {
  const hosts = {
    local,
    remotes: [machine("up"), machine("down"), machine("auth"), machine("new")],
  };
  applyRemoteConnection("env-local", { type: "ok", at: 1 });
  applyRemoteConnection("env-up", { type: "ok", at: 1 });
  fail("env-down", "Machine is unreachable");
  fail("env-auth", refusal);
  const entries = settingsHostEntries(hosts);
  expect(entries.map((entry) => entry.id)).toEqual(["local", "up", "down", "auth", "new"]);
  expect(entries.find((entry) => entry.id === "down")?.status).toBe("offline");
  expect(entries.find((entry) => entry.id === "auth")?.status).toBe("pair-again");
  expect(entries.find((entry) => entry.id === "new")?.status).toBe("checking");
  expect(settingsHostOptions(entries).map((option) => option.label)).toEqual(
    expect.arrayContaining([
      "This computer",
      "up",
      "down · Offline",
      "auth · Pair again",
      "new · Checking…",
    ]),
  );
});

it("maps every connection status to a Settings status", () => {
  const status = (value: RemoteConnectionState["status"], error?: string) =>
    settingsHostStatus({ status: value, error }).status;
  expect(status("connected")).toBe("connected");
  expect(status("connecting")).toBe("checking");
  expect(status("outdated-host")).toBe("update-needed");
  expect(status("identity-mismatch")).toBe("pair-again");
  for (const offline of [
    "unreachable",
    "needs-auth",
    "host-key",
    "host-not-running",
    "connection-blocked",
  ] as const)
    expect(status(offline)).toBe("offline");
  // A probe that taught the store nothing is offline, not "checking" forever.
  expect(settingsHostStatus({ status: "connecting" }, true).status).toBe("offline");
});

it("never falls back to another machine when the choice is gone", () => {
  const entries = settingsHostEntries({ local, remotes: [machine("up")] });
  expect(chooseSettingsHost(entries, undefined).entry?.id).toBe("local");
  expect(chooseSettingsHost(entries, "up").entry?.id).toBe("up");
  expect(chooseSettingsHost(entries, "removed")).toEqual({ entry: undefined, missing: true });
});

it("explains why a machine cannot be used, and says nothing for a connected one", () => {
  applyRemoteConnection("env-local", { type: "ok", at: 1 });
  fail("env-auth", refusal);
  const entries = settingsHostEntries({ local, remotes: [machine("auth")] });
  const message = (id: string) =>
    settingsHostUnavailableMessage(entries.find((entry) => entry.id === id)!);
  expect(message("local")).toBeUndefined();
  expect(message("auth")).toContain("Pair it again from Settings → Connections");
});

it("learns a machine's state in the background without rejecting", async () => {
  vi.mocked(machineCapabilities).mockResolvedValueOnce([]);
  await expect(probeSettingsHost(machine("up"))).resolves.toBe(true);
  expect(readRemoteConnection("env-up").status).toBe("connected");

  vi.mocked(machineCapabilities).mockRejectedValueOnce(new Error(refusal));
  await expect(probeSettingsHost(machine("auth"))).resolves.toBe(true);
  expect(readRemoteConnection("env-auth").status).toBe("identity-mismatch");

  // One timeout proves nothing: the store stays unknown and the caller is told.
  vi.mocked(machineCapabilities).mockRejectedValueOnce(
    new Error("Host rejected request [RPC_TIMEOUT] (environment.describe)"),
  );
  await expect(probeSettingsHost(machine("slow"))).resolves.toBe(false);
});
