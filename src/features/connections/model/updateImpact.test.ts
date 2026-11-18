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
  expect(rows).toHaveLength(2);
  expect(rows.find((row) => row.affected)).toMatchObject({ id: "remote", running: 1 });
});

it("keeps failed, incomplete and offline activity unknown", async () => {
  vi.mocked(remoteRequest).mockImplementation(async (id, method) => {
    if (id === "local") throw new Error("offline");
    return method === "projects.list" ? [{ id: "a" }] : { unchanged: true, etag: "old" };
  });
  expect((await readUpdateImpact("local-host")).every((row) => row.running === null)).toBe(true);
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
