import { afterEach, expect, it, vi } from "vitest";
import { RemoteSessionLists } from "./remoteSessionLists";
import type { HostSessionSummary } from "./protocol";

const summary = (title: string) => [{ id: "s", title, status: "idle" }] as HostSessionSummary[];

it("forces an owner verification inside TTL while coalescing concurrent forced reads", async () => {
  let finish!: (value: { unchanged: true; etag: string }) => void;
  const request = vi
    .fn()
    .mockResolvedValueOnce({ etag: "e1", sessions: summary("A") })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const cache = new RemoteSessionLists(request);
  const original = await cache.load("m", "p");
  const forced = cache.load("m", "p", true);
  const duplicate = cache.load("m", "p", true);
  expect(request).toHaveBeenCalledTimes(2);
  expect(duplicate).toBe(forced);
  finish({ unchanged: true, etag: "e1" });
  expect(await forced).toBe(original);
});
afterEach(() => vi.useRealTimers());

it("discards the pre-restart etag before accepting a reset project payload", async () => {
  const request = vi
    .fn()
    .mockResolvedValue({ etag: "new-full", sessions: summary("Owner after restart") });
  const cache = new RemoteSessionLists(request);
  cache.publish("m", "p", summary("Old cached row"), "old-etag");
  expect(
    cache.applyChange(
      "m",
      "p",
      { projectId: "p", base: "old-etag", etag: "new-delta", updated: summary("Delta only") },
      true,
    ),
  ).toBeUndefined();
  expect(cache.known("m", "p")).toBeUndefined();
  expect((await cache.load("m", "p", true))[0].title).toBe("Owner after restart");
  expect(request).toHaveBeenCalledWith("m", "p", "");
  expect(
    cache.applyChange("m", "p", { projectId: "p", etag: "full-reset", sessions: [] }, true),
  ).toEqual([]);
});

it("shares simultaneous requests and retains the same array for unchanged results", async () => {
  vi.useFakeTimers();
  const request = vi.fn(async () => summary("A"));
  const cache = new RemoteSessionLists(request);
  const reads = Array.from({ length: 20 }, () => cache.load("machine", "project"));
  const results = await Promise.all(reads);
  expect(request).toHaveBeenCalledTimes(1);
  expect(results.every((value) => value === results[0])).toBe(true);
  vi.advanceTimersByTime(5_001);
  expect(await cache.load("machine", "project")).toBe(results[0]);
  expect(request).toHaveBeenCalledTimes(2);
});

it("invalidates an in-flight read without letting its stale result replace newer data", async () => {
  let finish!: (value: HostSessionSummary[]) => void;
  const request = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(summary("new"));
  const cache = new RemoteSessionLists(request);
  const old = cache.load("machine", "project");
  cache.invalidate();
  const latest = await cache.load("machine", "project");
  finish(summary("old"));
  expect(await old).toBe(latest);
  expect(await cache.load("machine", "project")).toBe(latest);
  expect(latest[0].title).toBe("new");
});

it("does not share projects across machines and retries failed reads", async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]);
  const cache = new RemoteSessionLists(request);
  await expect(cache.load("A", "project")).rejects.toThrow("offline");
  await cache.load("A", "project");
  await cache.load("B", "project");
  expect(request).toHaveBeenCalledTimes(3);
});

it("asks with the held etag and keeps the same array when the host says unchanged", async () => {
  vi.useFakeTimers();
  const request = vi
    .fn()
    .mockResolvedValueOnce({ etag: "e1", sessions: summary("A") })
    .mockResolvedValueOnce({ unchanged: true, etag: "e1" })
    .mockResolvedValueOnce({ etag: "e2", sessions: summary("B") });
  const cache = new RemoteSessionLists(request);
  const first = await cache.load("m", "p");
  expect(request).toHaveBeenLastCalledWith("m", "p", "");
  vi.advanceTimersByTime(5_001);
  expect(await cache.load("m", "p")).toBe(first);
  expect(request).toHaveBeenLastCalledWith("m", "p", "e1");
  vi.advanceTimersByTime(5_001);
  const changed = await cache.load("m", "p");
  expect(request).toHaveBeenLastCalledWith("m", "p", "e1");
  expect(changed[0].title).toBe("B");
});

it("falls back to the full list for a host that ignores the etag", async () => {
  vi.useFakeTimers();
  const request = vi.fn(async () => summary("A"));
  const cache = new RemoteSessionLists(request);
  await cache.load("m", "p");
  vi.advanceTimersByTime(5_001);
  await cache.load("m", "p");
  expect(request).toHaveBeenLastCalledWith("m", "p", "");
});

it("applies summary deltas only to their exact base and preserves unchanged rows", () => {
  const cache = new RemoteSessionLists(vi.fn());
  const first = summary("A");
  first.push({ ...first[0]!, id: "keep", title: "Keep" });
  const initial = cache.publish("m", "p", first, "e1");
  const unchanged = initial[1]!;
  expect(
    cache
      .applyChange("m", "p", {
        projectId: "p",
        etag: "e2",
        base: "e1",
        upserts: [{ ...first[0]!, title: "B" }],
        removed: ["keep"],
      })
      ?.map((entry) => entry.title),
  ).toEqual(["B"]);
  expect(
    cache.applyChange("m", "p", {
      projectId: "p",
      etag: "e3",
      base: "e1",
      upserts: [],
      removed: [],
    }),
  ).toBeUndefined();
  const stable = cache.publish("m", "p", [{ ...first[0]!, title: "B" }, unchanged], "e4");
  expect(stable[1]).toBe(unchanged);
});

it("does not let an in-flight list reply overwrite a newer pushed delta", async () => {
  let finish!: (value: { etag: string; sessions: HostSessionSummary[] }) => void;
  const request = vi.fn(
    () =>
      new Promise<{ etag: string; sessions: HostSessionSummary[] }>((resolve) => {
        finish = resolve;
      }),
  );
  const cache = new RemoteSessionLists(request);
  const pending = cache.load("m", "p");
  const fresh = cache.publish("m", "p", summary("pushed"), "e2");
  finish({ etag: "e1", sessions: summary("stale") });
  expect(await pending).toBe(fresh);
  expect((await cache.load("m", "p"))[0]!.title).toBe("pushed");
});
