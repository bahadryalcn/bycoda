import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveProjectLocation, revokeFileAccess } from "../../../platform/tauri/fs";
import {
  forgetProjectLocation,
  invalidateProjectLocation,
  rememberProjectLocation,
  synchronizeProjectLocation,
} from "./projectLocation";

vi.mock("../../../platform/tauri/fs", () => ({
  resolveProjectLocation: vi.fn(),
  revokeFileAccess: vi.fn().mockResolvedValue(undefined),
}));

function mockLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() {
        return data.size;
      },
    },
  });
}

beforeEach(() => {
  invalidateProjectLocation();
  mockLocalStorage();
  vi.mocked(resolveProjectLocation).mockReset();
  vi.mocked(revokeFileAccess).mockClear();
});

describe("project location synchronization", () => {
  it("records an identity and uses it to follow a rename", async () => {
    vi.mocked(resolveProjectLocation)
      .mockResolvedValueOnce({ path: "/work/bycoda", identity: "unix:1:2" })
      .mockResolvedValueOnce({
        path: "/work/bycoda-personal",
        identity: "unix:1:2",
      });

    await rememberProjectLocation("/work/bycoda");
    await expect(synchronizeProjectLocation("/work/bycoda")).resolves.toEqual({
      path: "/work/bycoda-personal",
      identity: "unix:1:2",
      moved: true,
    });
    expect(resolveProjectLocation).toHaveBeenLastCalledWith("/work/bycoda", "unix:1:2");
  });

  it("cannot guess a rename before an identity has been recorded", async () => {
    vi.mocked(resolveProjectLocation).mockResolvedValueOnce(null);
    await expect(synchronizeProjectLocation("/work/missing")).resolves.toBeNull();
    expect(resolveProjectLocation).toHaveBeenCalledWith("/work/missing", undefined);
  });

  it("forgets the saved identity when a project is removed", async () => {
    vi.mocked(resolveProjectLocation)
      .mockResolvedValueOnce({ path: "/work/repo", identity: "unix:1:2" })
      .mockResolvedValueOnce(null);
    await rememberProjectLocation("/work/repo");
    forgetProjectLocation("/work/repo");
    expect(revokeFileAccess).toHaveBeenCalledWith("/work/repo");
    await synchronizeProjectLocation("/work/repo");
    expect(resolveProjectLocation).toHaveBeenLastCalledWith("/work/repo", undefined);
  });
});

describe("concurrent synchronization", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  function storedLocations() {
    return JSON.parse(localStorage.getItem("bycoda.projectLocations") ?? "{}") as Record<
      string,
      { path: string; identity: string }
    >;
  }

  it("keeps identities recorded by other syncs while a resolve is in flight", async () => {
    const first = deferred<{ path: string; identity: string }>();
    const second = deferred<{ path: string; identity: string }>();
    vi.mocked(resolveProjectLocation).mockImplementation((path) =>
      path === "/work/one" ? first.promise : second.promise,
    );

    const syncOne = synchronizeProjectLocation("/work/one");
    const syncTwo = synchronizeProjectLocation("/work/two");
    first.resolve({ path: "/work/one", identity: "unix:1:1" });
    await syncOne;
    second.resolve({ path: "/work/two", identity: "unix:2:2" });
    await syncTwo;

    const stored = Object.values(storedLocations());
    expect(stored).toHaveLength(2);
    expect(stored).toEqual(
      expect.arrayContaining([
        { path: "/work/one", identity: "unix:1:1" },
        { path: "/work/two", identity: "unix:2:2" },
      ]),
    );
  });

  it("keeps an identity remembered during a resolve when a moved project is replaced", async () => {
    vi.mocked(resolveProjectLocation).mockResolvedValueOnce({
      path: "/work/old",
      identity: "unix:3:3",
    });
    await rememberProjectLocation("/work/old");

    const moving = deferred<{ path: string; identity: string }>();
    vi.mocked(resolveProjectLocation).mockImplementation((path) =>
      path === "/work/old"
        ? moving.promise
        : Promise.resolve({ path: "/work/other", identity: "unix:4:4" }),
    );
    const sync = synchronizeProjectLocation("/work/old");
    await rememberProjectLocation("/work/other");
    moving.resolve({ path: "/work/new", identity: "unix:3:3" });
    await expect(sync).resolves.toMatchObject({ path: "/work/new", moved: true });

    const stored = Object.values(storedLocations());
    expect(stored).toHaveLength(2);
    expect(stored).toEqual(
      expect.arrayContaining([
        { path: "/work/new", identity: "unix:3:3" },
        { path: "/work/other", identity: "unix:4:4" },
      ]),
    );
  });

  it("does not rewrite storage when the resolved identity is already saved", async () => {
    vi.mocked(resolveProjectLocation).mockResolvedValue({
      path: "/work/same",
      identity: "unix:5:5",
    });
    await rememberProjectLocation("/work/same");
    const setItem = vi.spyOn(localStorage, "setItem");

    await synchronizeProjectLocation("/work/same");
    await rememberProjectLocation("/work/same");

    expect(setItem).not.toHaveBeenCalled();
  });

  it("writes when a stored identity changes", async () => {
    vi.mocked(resolveProjectLocation).mockResolvedValueOnce({
      path: "/work/same",
      identity: "unix:5:5",
    });
    await rememberProjectLocation("/work/same");
    const setItem = vi.spyOn(localStorage, "setItem");
    vi.mocked(resolveProjectLocation).mockResolvedValueOnce({
      path: "/work/same",
      identity: "unix:6:6",
    });

    await synchronizeProjectLocation("/work/same");

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(Object.values(storedLocations())).toEqual([
      { path: "/work/same", identity: "unix:6:6" },
    ]);
  });
});

describe("short lived validation cache", () => {
  it("reuses successful unchanged identity but revalidates after access invalidation", async () => {
    vi.mocked(resolveProjectLocation).mockResolvedValue({
      path: "/work/cache",
      identity: "unix:5:6",
    });
    await synchronizeProjectLocation("/work/cache");
    await synchronizeProjectLocation("/work/cache");
    expect(resolveProjectLocation).toHaveBeenCalledTimes(1);
    invalidateProjectLocation("/work/cache");
    vi.mocked(resolveProjectLocation).mockResolvedValue(null);
    expect(await synchronizeProjectLocation("/work/cache")).toBeNull();
    expect(resolveProjectLocation).toHaveBeenCalledTimes(2);
  });
  it("expires successful locations and never caches missing paths", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      vi.mocked(resolveProjectLocation).mockResolvedValue({
        path: "/work/cache",
        identity: "unix:5:6",
      });
      await synchronizeProjectLocation("/work/cache");
      now.mockReturnValue(3_001);
      vi.mocked(resolveProjectLocation).mockResolvedValue(null);
      await synchronizeProjectLocation("/work/cache");
      await synchronizeProjectLocation("/work/cache");
      expect(resolveProjectLocation).toHaveBeenCalledTimes(3);
    } finally {
      now.mockRestore();
    }
  });
});
