import { afterEach, beforeEach, expect, it, vi } from "vitest";

const runMachineCommand = vi.hoisted(() => vi.fn());
vi.mock("../../connections/model/remoteCommands", () => ({ runMachineCommand }));

beforeEach(() => {
  vi.resetModules();
  runMachineCommand.mockReset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

it("shares one inventory RPC across concurrent readers and recent reopens", async () => {
  const { listMachineSkills } = await import("./machineSkills");
  const skills = [{ name: "one" }];
  runMachineCommand.mockResolvedValue(skills);
  const results = await Promise.all(
    Array.from({ length: 171 }, () => listMachineSkills("mac", "", { refresh: false })),
  );
  expect(results.every((result) => result === skills)).toBe(true);
  await listMachineSkills("mac", "", { refresh: false });
  expect(runMachineCommand).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(30_001);
  await listMachineSkills("mac", "", { refresh: false });
  expect(runMachineCommand).toHaveBeenCalledTimes(2);
});

it("backs off failed discovery without blocking another machine", async () => {
  const { listMachineSkills } = await import("./machineSkills");
  runMachineCommand.mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]);
  await expect(listMachineSkills("offline", "", { refresh: false })).rejects.toThrow("offline");
  await expect(listMachineSkills("offline", "", { refresh: false })).rejects.toThrow("offline");
  expect(await listMachineSkills("online")).toEqual([]);
  expect(runMachineCommand).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(5_001);
  await listMachineSkills("offline");
  expect(runMachineCommand).toHaveBeenCalledTimes(3);
});

it("keeps personal and project inventories separate", async () => {
  const { listMachineSkills } = await import("./machineSkills");
  runMachineCommand.mockResolvedValue([]);
  await listMachineSkills("mac");
  await listMachineSkills("mac", "remote://mac/work");
  expect(runMachineCommand).toHaveBeenCalledTimes(2);
});

it("shows cached data during refresh and fences an older response", async () => {
  const { listMachineSkills, cachedMachineSkills } = await import("./machineSkills");
  const initial = [{ name: "initial" }];
  runMachineCommand.mockResolvedValueOnce(initial);
  await listMachineSkills("mac");
  let finish!: (value: unknown) => void;
  runMachineCommand.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
  const older = listMachineSkills("mac", "", { refresh: true });
  expect(cachedMachineSkills("mac")).toEqual(initial);
  const newer = [{ name: "new" }];
  runMachineCommand.mockResolvedValueOnce(newer);
  await listMachineSkills("mac", "", { refresh: true });
  finish([{ name: "old" }]);
  expect(await older).toEqual(newer);
  expect(cachedMachineSkills("mac")).toEqual(newer);
});

it("retains successful inventory on failure and lets explicit retry bypass backoff", async () => {
  const { listMachineSkills, cachedMachineSkills } = await import("./machineSkills");
  const initial = [{ name: "initial" }];
  runMachineCommand.mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error("offline"));
  await listMachineSkills("mac");
  await expect(listMachineSkills("mac", "", { refresh: true })).rejects.toThrow("offline");
  expect(cachedMachineSkills("mac")).toEqual(initial);
  runMachineCommand.mockResolvedValueOnce([]);
  expect(await listMachineSkills("mac", "", { refresh: true })).toEqual([]);
});

it("rejects malformed replies instead of reporting every skill missing", async () => {
  const { listMachineSkills } = await import("./machineSkills");
  runMachineCommand.mockResolvedValue({ error: "unavailable" });
  await expect(listMachineSkills("mac")).rejects.toThrow("invalid inventory");
});

it("re-reads by default so existing mutation refreshes cannot use stale inventories", async () => {
  const { listMachineSkills } = await import("./machineSkills");
  runMachineCommand.mockResolvedValueOnce([{ name: "deleted" }]).mockResolvedValueOnce([]);
  await listMachineSkills("mac");
  expect(await listMachineSkills("mac")).toEqual([]);
  expect(runMachineCommand).toHaveBeenCalledTimes(2);
});

it("bounds retained project inventories", async () => {
  const { listMachineSkills, cachedMachineSkills } = await import("./machineSkills");
  runMachineCommand.mockResolvedValue([]);
  for (let index = 0; index < 129; index++)
    await listMachineSkills("mac", `remote://mac/project-${index}`);
  expect(cachedMachineSkills("mac", "remote://mac/project-0")).toBeNull();
  expect(cachedMachineSkills("mac", "remote://mac/project-128")).toEqual([]);
});
