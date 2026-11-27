import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "./connections";
import { readUpdateImpact } from "./updateImpact";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./connections", () => ({ remoteRequest: vi.fn() }));
const local = {
  id: "local",
  environmentId: "local-env",
  name: "Work PC",
  localHost: true,
  endpoint: "local",
};
const remote = { id: "remote", environmentId: "remote-env", name: "Mac", endpoint: "remote" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(invoke).mockResolvedValue([remote, local]);
  vi.mocked(remoteRequest).mockImplementation(async (_id, method) =>
    method === "projects.list"
      ? [{ id: "project" }]
      : [
          { id: "host", status: "running", executionOwner: "host" },
          { id: "desktop", status: "running", executionOwner: "desktop" },
          { id: "legacy", status: "running" },
          { id: "idle", status: "idle" },
        ],
  );
});

it("shows every machine, with local first and conservative desktop interruption counts", async () => {
  const rows = await readUpdateImpact("app");
  expect(rows.map((row) => row.id)).toEqual(["local", "remote"]);
  expect(rows[0]).toMatchObject({ running: 3, desktopRunning: 2, affected: true });
  expect(rows[1]).toMatchObject({ running: 3, desktopRunning: 2, affected: false });
  expect(remoteRequest).toHaveBeenCalledWith(
    "remote",
    "projects.list",
    {},
    false,
    false,
    "remote-env",
  );
});

it("reports responsive machines before an unreachable peer's read times out", async () => {
  vi.useFakeTimers();
  try {
    const request = vi.mocked(remoteRequest).getMockImplementation()!;
    vi.mocked(remoteRequest).mockImplementation((...args) =>
      args[0] === "remote" ? new Promise(() => {}) : request(...args),
    );
    const onMachine = vi.fn();
    const pending = readUpdateImpact("app", onMachine);
    await vi.advanceTimersByTimeAsync(0);
    expect(onMachine).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "local", running: 3 }),
    );
    await vi.advanceTimersByTimeAsync(8_000);
    expect((await pending)[1]).toMatchObject({ id: "remote", running: null });
  } finally {
    vi.useRealTimers();
  }
});

it("deduplicates alternate routes and repeated session IDs", async () => {
  vi.mocked(invoke).mockResolvedValue([remote, { ...local, id: "alias", localHost: false }, local]);
  vi.mocked(remoteRequest).mockImplementation(async (_id, method) =>
    method === "projects.list"
      ? [{ id: "a" }, { id: "b" }]
      : { etag: "fresh", sessions: [{ id: "one", status: "running", executionOwner: "host" }] },
  );
  const rows = await readUpdateImpact({ machineId: "remote" });
  expect(rows).toHaveLength(1);
  expect(rows.find((row) => row.affected)).toMatchObject({ id: "remote", running: 1 });
});

it("keeps failed, incomplete and offline activity unknown", async () => {
  vi.mocked(remoteRequest).mockImplementation(async (id, method) => {
    if (id === "local") throw new Error("offline");
    return method === "projects.list" ? [{ id: "a" }] : { unchanged: true, etag: "old" };
  });
  expect((await readUpdateImpact("app")).every((row) => row.running === null)).toBe(true);
  vi.mocked(invoke).mockResolvedValue(null);
  expect((await readUpdateImpact("local-host"))[0].running).toBeNull();
});

it("includes this computer even before local Host pairing", async () => {
  vi.mocked(invoke).mockResolvedValue([]);
  expect(await readUpdateImpact("app")).toEqual([
    {
      id: "this-computer",
      name: "",
      local: true,
      affected: true,
      running: null,
      desktopRunning: null,
    },
  ]);
});

it("preserves the selected route and local identity when one Host has several routes", async () => {
  vi.mocked(invoke).mockResolvedValue([{ ...local, id: "selected", localHost: false }, local]);
  const rows = await readUpdateImpact({ machineId: "selected" });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: "selected", local: true, affected: true });
});

it("bounds unavailable Host reads without turning a timeout into zero", async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(remoteRequest).mockReturnValue(new Promise(() => {}));
    const pending = readUpdateImpact("app");
    await vi.advanceTimersByTimeAsync(8_000);
    expect((await pending).every((row) => row.running === null)).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it("reads one local lifecycle summary even without a paired machine", async () => {
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "local_host_update_activity" ? 3 : [remote],
  );
  const onMachine = vi.fn();
  const rows = await readUpdateImpact("local-host", onMachine);
  expect(rows).toEqual([expect.objectContaining({ affected: true, local: true, running: 3 })]);
  expect(onMachine).toHaveBeenCalledExactlyOnceWith(rows[0]);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(remoteRequest).not.toHaveBeenCalled();
});

it("bounds project reads on a selected remote Host", async () => {
  let active = 0,
    peak = 0;
  vi.mocked(remoteRequest).mockImplementation(async (id, method) => {
    expect(id).toBe("remote");
    if (method === "projects.list")
      return Array.from({ length: 128 }, (_, i) => ({ id: String(i) }));
    peak = Math.max(peak, ++active);
    await Promise.resolve();
    active--;
    return [];
  });
  expect((await readUpdateImpact({ machineId: "remote" }))[0].running).toBe(0);
  expect(peak).toBeLessThanOrEqual(4);
});

it("stops scheduling projects once an activity check times out", async () => {
  vi.useFakeTimers();
  try {
    let resolveProjects!: (value: { id: string }[]) => void;
    const projects = new Promise<{ id: string }[]>((resolve) => {
      resolveProjects = resolve;
    });
    vi.mocked(remoteRequest).mockReturnValue(projects);
    const pending = readUpdateImpact({ machineId: "remote" });
    await vi.advanceTimersByTimeAsync(8_000);
    expect((await pending)[0].running).toBeNull();
    resolveProjects([{ id: "late" }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(remoteRequest).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
