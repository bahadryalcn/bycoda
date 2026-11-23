// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { saveRemoteAutoReconnect } from "../../settings/model/settings";
import { adoptRemoteMachineInventory, remoteRequest } from "./connections";
import {
  COLD_ROUTE_READS_PER_MACHINE,
  COLD_ROUTE_SLOT_MS,
  isColdRouteRead,
  resetColdRouteReadsForTests,
} from "./coldRouteReads";
import { recordRemoteConnection, resetRemoteHealth } from "./remoteHealth";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));

// The first seconds of a cold boot: every restored pane reads at once, before the SSH tunnel exists.
const coldReads = [
  ["workspace.run", { command: "read_file_info", args: { path: "/srv/a" } }],
  ["workspace.run", { command: "read_text_file", args: { path: "/srv/a" } }],
  ["workspace.run", { command: "list_project_files", args: { cwd: "/srv" } }],
  ["workspace.run", { command: "list_dir", args: { path: "/srv" } }],
  ["workspace.run", { command: "git_history", args: { cwd: "/srv" } }],
  ["workspace.run", { command: "git_worktrees", args: { cwd: "/srv" } }],
  ["workspace.run", { command: "git_submodules", args: { cwd: "/srv" } }],
  ["workspace.run", { command: "git_file_diff", args: { cwd: "/srv" } }],
  ["workspace.run", { command: "git_diff_stats", args: { cwd: "/srv" } }],
  ["workspace.run", { command: "stat_files", args: { paths: ["/srv/file"] } }],
  ["workspace.run", { command: "git_branches", args: { cwd: "/srv" } }],
  ["workspace.run", { command: "skill_policy_get", args: {} }],
  ["projects.list", {}],
  ["goals.list", {}],
  ["sessions.list", { projectId: "p" }],
] as const;

let counter = 0;
function coldMachine() {
  counter += 1;
  const machine = {
    id: `cold-${counter}`,
    name: "Mac",
    environmentId: `cold-env-${counter}`,
    endpoint: "",
    ssh: { target: "owner@mac", remotePort: 7000 },
  };
  adoptRemoteMachineInventory([machine]);
  return machine;
}
const requestsOf = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === "remote_request")
    .map(([, args]) => args as { method: string; params?: { command?: string } });

afterEach(() => {
  vi.useRealTimers();
  resetColdRouteReadsForTests();
  adoptRemoteMachineInventory([]);
  resetRemoteHealth();
  saveRemoteAutoReconnect(true);
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async () => []);
});

it("holds every idempotent read of a cold SSH machine behind one shared discovery", async () => {
  const machine = coldMachine();
  const discovery = Promise.withResolvers<{ capabilities: string[] }>();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command !== "remote_request") return;
    const { method } = args as { method: string };
    return method === "environment.describe" ? discovery.promise : [];
  });
  const reads = coldReads.map(([method, params]) => remoteRequest(machine.id, method, params));
  try {
    await vi.waitFor(() =>
      expect(requestsOf().map((r) => r.method)).toEqual(["environment.describe"]),
    );
  } finally {
    discovery.resolve({ capabilities: [] });
    await Promise.all(reads);
  }
  const sent = requestsOf();
  expect(
    sent.map((r) => r.method).filter((method) => method === "environment.describe"),
  ).toHaveLength(1);
  expect(sent).toHaveLength(1 + coldReads.length);
  expect(sent[0]?.method).toBe("environment.describe");
});

it("never holds or replays a write behind discovery", async () => {
  const machine = coldMachine();
  const discovery = Promise.withResolvers<{ capabilities: string[] }>();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command !== "remote_request") return;
    return (args as { method: string }).method === "environment.describe" ? discovery.promise : {};
  });
  const write = remoteRequest(machine.id, "workspace.run", {
    command: "write_text_file",
    args: { path: "/srv/a", content: "x" },
  });
  const read = remoteRequest(machine.id, "workspace.run", { command: "read_text_file", args: {} });
  try {
    await vi.waitFor(() =>
      expect(requestsOf().map((r) => r.params?.command ?? r.method)).toEqual([
        "write_text_file",
        "environment.describe",
      ]),
    );
  } finally {
    discovery.resolve({ capabilities: [] });
    await Promise.all([write, read]);
  }
  expect(requestsOf().filter((r) => r.params?.command === "write_text_file")).toHaveLength(1);
});

it("fails the held reads with the discovery's error and sends none of them", async () => {
  const machine = coldMachine();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command !== "remote_request") return;
    if ((args as { method: string }).method === "environment.describe")
      throw "SSH connection failed (exit 255, host unreachable)";
    return [];
  });
  const outcomes = await Promise.allSettled(
    coldReads.map(([method, params]) => remoteRequest(machine.id, method, params)),
  );
  expect(outcomes.every((outcome) => outcome.status === "rejected")).toBe(true);
  expect(requestsOf().map((r) => r.method)).toEqual(["environment.describe"]);
});

it("drops a held read when its machine is replaced while discovery runs", async () => {
  const machine = coldMachine();
  const discovery = Promise.withResolvers<{ capabilities: string[] }>();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command !== "remote_request") return;
    return (args as { method: string }).method === "environment.describe" ? discovery.promise : [];
  });
  const held = remoteRequest(machine.id, "workspace.run", { command: "list_dir", args: {} }).catch(
    (error: unknown) => error,
  );
  await vi.waitFor(() =>
    expect(requestsOf().map((r) => r.method)).toEqual(["environment.describe"]),
  );
  adoptRemoteMachineInventory([{ ...machine, environmentId: "replacement-env" }]);
  discovery.resolve({ capabilities: [] });
  expect(String(await held)).toContain("Connection changed");
  expect(requestsOf().map((r) => r.method)).toEqual(["environment.describe"]);
});

it("lets owner actions, recovery probes and a manual-only machine read without waiting", async () => {
  const machine = coldMachine();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command !== "remote_request") return;
    return (args as { method: string }).method === "environment.describe"
      ? new Promise(() => {})
      : [];
  });
  const read = { command: "list_dir", args: {} };
  await remoteRequest(machine.id, "workspace.run", read, false, true); // owner opened a folder
  await remoteRequest(machine.id, "workspace.run", read, true); // fresh reconnect probe
  saveRemoteAutoReconnect(false);
  recordRemoteConnection(machine.environmentId, "Machine is unreachable. Check the host.");
  await remoteRequest(machine.id, "workspace.run", read); // background poll, automatic reconnect off
  expect(requestsOf().map((r) => r.method)).toEqual([
    "workspace.run",
    "workspace.run",
    "workspace.run",
  ]);
  expect(requestsOf()[2]).toMatchObject({ allowConnect: false });
});

it("classifies only idempotent reads as cold-route reads", () => {
  for (const [method, params] of coldReads) expect(isColdRouteRead(method, params)).toBe(true);
  for (const command of [
    "write_text_file",
    "git_commit",
    "git_push",
    "delete_path",
    "skill_policy_set",
    "git_stage_file",
  ])
    expect(isColdRouteRead("workspace.run", { command, args: {} })).toBe(false);
  expect(isColdRouteRead("workspace.run", {})).toBe(false);
  expect(isColdRouteRead("commands.dispatch", { type: "send" })).toBe(false);
  expect(isColdRouteRead("environment.describe", {})).toBe(false);
});

it("releases held reads within the Host's per-device budget, and lends a slow read's slot on", async () => {
  vi.useFakeTimers();
  const machine = coldMachine();
  let running = 0;
  let peak = 0;
  const gates: (() => void)[] = [];
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command !== "remote_request") return;
    if ((args as { method: string }).method === "environment.describe") return { capabilities: [] };
    running += 1;
    peak = Math.max(peak, running);
    await new Promise<void>((resolve) => gates.push(resolve));
    running -= 1;
    return [];
  });
  const reads = coldReads.map(([method, params]) => remoteRequest(machine.id, method, params));
  await vi.advanceTimersByTimeAsync(0);
  expect(running).toBe(COLD_ROUTE_READS_PER_MACHINE);
  // Hung reads do not stall the queue forever: their slots are lent out after the slot deadline.
  await vi.advanceTimersByTimeAsync(COLD_ROUTE_SLOT_MS);
  expect(running).toBeGreaterThan(COLD_ROUTE_READS_PER_MACHINE);
  for (let round = 0; round < coldReads.length; round++) {
    gates.splice(0).forEach((open) => open());
    await vi.advanceTimersByTimeAsync(COLD_ROUTE_SLOT_MS);
  }
  await Promise.all(reads);
  expect(requestsOf()).toHaveLength(1 + coldReads.length);
  expect(peak).toBeLessThanOrEqual(coldReads.length);
});

const connecting = "Machine is unreachable right now: a connection attempt is in progress.";

it("asks the shared discovery again, boundedly, only when the dial in progress refused it unsent", async () => {
  vi.useFakeTimers();
  const machine = coldMachine();
  let refusals = 2;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command !== "remote_request") return;
    if ((args as { method: string }).method !== "environment.describe") return [];
    if (refusals-- > 0) throw connecting;
    return { capabilities: [] };
  });
  const reads = coldReads.map(([method, params]) => remoteRequest(machine.id, method, params));
  await vi.advanceTimersByTimeAsync(10_000);
  await Promise.all(reads);
  const methods = requestsOf().map((r) => r.method);
  expect(methods.filter((method) => method === "environment.describe")).toHaveLength(3);
  expect(methods).toHaveLength(3 + coldReads.length);
});

it("does not retry a discovery that failed any other way, nor one whose budget is spent", async () => {
  vi.useFakeTimers();
  const other = coldMachine();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command !== "remote_request") return;
    if ((args as { method: string }).method === "environment.describe")
      throw "SSH connection failed (exit 255, host unreachable)";
    return [];
  });
  const failed = remoteRequest(other.id, "projects.list").catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(String(await failed)).toContain("SSH connection failed");
  expect(requestsOf().filter((r) => r.method === "environment.describe")).toHaveLength(1);

  vi.mocked(invoke).mockClear();
  const busy = coldMachine();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command !== "remote_request") return;
    if ((args as { method: string }).method === "environment.describe") throw connecting;
    return [];
  });
  const exhausted = remoteRequest(busy.id, "projects.list").catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(String(await exhausted)).toBe(connecting);
  expect(requestsOf().filter((r) => r.method === "environment.describe")).toHaveLength(9);
  expect(requestsOf().filter((r) => r.method === "projects.list")).toHaveLength(0);
});

it("stops retrying the discovery when automatic dialing is turned off or the route is replaced", async () => {
  vi.useFakeTimers();
  const first = coldMachine();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command !== "remote_request") return;
    if ((args as { method: string }).method === "environment.describe") throw connecting;
    return [];
  });
  const paused = remoteRequest(first.id, "projects.list").catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(300);
  saveRemoteAutoReconnect(false);
  recordRemoteConnection(first.environmentId, "Machine is unreachable. Check the host.");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(String(await paused)).toBe(connecting);
  expect(requestsOf().filter((r) => r.method === "environment.describe")).toHaveLength(2);

  saveRemoteAutoReconnect(true);
  resetRemoteHealth();
  vi.mocked(invoke).mockClear();
  const second = coldMachine();
  const replaced = remoteRequest(second.id, "projects.list").catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(300);
  adoptRemoteMachineInventory([{ ...second, environmentId: "replacement-env" }]);
  await vi.advanceTimersByTimeAsync(60_000);
  await replaced;
  expect(requestsOf().filter((r) => r.method === "environment.describe")).toHaveLength(2);
  expect(requestsOf().filter((r) => r.method === "projects.list")).toHaveLength(0);
});

it("fails an explicit receipt-checked command at once while startup reads wait in backoff", async () => {
  vi.useFakeTimers();
  const machine = coldMachine();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command !== "remote_request") return;
    if ((args as { method: string }).method === "environment.describe") throw connecting;
    return [];
  });
  const restore = remoteRequest(machine.id, "projects.list").catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(10); // the first probe was refused; the restore is now sleeping
  expect(requestsOf().map((r) => r.method)).toEqual(["environment.describe"]);

  const explicit = remoteRequest(machine.id, "commands.dispatch", {
    type: "cancel",
    runId: "desktop",
    sessionId: "s1",
  }).catch((error: unknown) => error);
  // No timer advance: the command has to fail without waiting for the restore's backoff.
  expect(String(await explicit)).toBe(connecting);
  expect(requestsOf().map((r) => r.method)).toEqual([
    "environment.describe",
    "environment.describe",
  ]);
  expect(requestsOf().some((r) => r.method === "commands.dispatch")).toBe(false);

  await vi.advanceTimersByTimeAsync(60_000);
  expect(String(await restore)).toBe(connecting);
  expect(requestsOf().some((r) => r.method === "commands.dispatch")).toBe(false);
});
