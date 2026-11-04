import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LiveAgentWindowWatches, type LiveAgentWindowPeer } from "./liveAgentWindowWatches";
import type { WindowLiveAgents } from "./windowLiveAgents";

const record = (
  sourceId = "original",
  revision = 1,
  ownerWindowLabel = "peer",
): WindowLiveAgents => ({ ownerWindowLabel, sourceId, revision, agents: [] });
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const owners: LiveAgentWindowWatches[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  owners.splice(0).forEach((owner) => owner.dispose());
  vi.useRealTimers();
});
function fixture() {
  const current = new Map<string, WindowLiveAgents>();
  const destroyed: Array<() => void> = [];
  const stops: Array<ReturnType<typeof vi.fn>> = [];
  const peer: LiveAgentWindowPeer = {
    label: "peer",
    listenDestroyed: vi.fn(async (handler) => {
      destroyed.push(handler);
      const stop = vi.fn();
      stops.push(stop);
      return stop;
    }),
  };
  const native = vi.fn<() => Promise<readonly LiveAgentWindowPeer[]>>().mockResolvedValue([peer]);
  let visible = true;
  const missing = vi.fn((entry: WindowLiveAgents) => {
    if (current.get(entry.ownerWindowLabel) === entry) current.delete(entry.ownerWindowLabel);
  });
  const owner = new LiveAgentWindowWatches({
    listWindows: native,
    current: (label) => current.get(label),
    missing,
    visible: () => visible,
  });
  owners.push(owner);
  return {
    owner,
    peer,
    native,
    current,
    missing,
    destroyed,
    stops,
    visibility: (value: boolean) => {
      visible = value;
    },
    observe: (entry: WindowLiveAgents) => {
      current.set(entry.ownerWindowLabel, entry);
      owner.observe(entry);
    },
  };
}

it("batches a new peer set once and has no healthy periodic native polling", async () => {
  const f = fixture();
  f.native.mockResolvedValue([f.peer, { ...f.peer, label: "second" }]);
  f.observe(record());
  f.observe(record("second-source", 1, "second"));
  await flush();
  expect(f.native).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(300_000);
  expect(f.native).toHaveBeenCalledTimes(1);
  f.observe(record("original", 2));
  await flush();
  expect(f.native).toHaveBeenCalledTimes(1);
  expect(f.stops.every((stop) => !stop.mock.calls.length)).toBe(true);
});

it("removes only the captured record after a destroy event and fresh native absence", async () => {
  const f = fixture();
  const original = record();
  f.observe(original);
  await flush();
  f.native.mockResolvedValue([]);
  f.destroyed[0]();
  await flush();
  expect(f.missing).toHaveBeenCalledExactlyOnceWith(original);
  expect(f.stops[0]).toHaveBeenCalledOnce();
});

it("ignores an old destroy/GONE for a same-label replacement and retains a currently existing native peer", async () => {
  const f = fixture();
  f.observe(record());
  await flush();
  const old = f.destroyed[0];
  const replacement = record("replacement");
  f.observe(replacement);
  await flush();
  f.native.mockClear();
  old();
  f.owner.gone("peer", "original");
  await flush();
  expect(f.native).not.toHaveBeenCalled();
  expect(f.current.get("peer")).toBe(replacement);
  f.owner.gone("peer", "replacement");
  await flush();
  expect(f.native).toHaveBeenCalledOnce();
  expect(f.missing).not.toHaveBeenCalled();
});

it("does not apply an in-flight old enumeration to a replacement source", async () => {
  const f = fixture();
  let resolve!: (peers: readonly LiveAgentWindowPeer[]) => void;
  f.native.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  f.observe(record());
  await flush();
  const replacement = record("replacement");
  f.observe(replacement);
  resolve([]);
  await flush();
  expect(f.current.get("peer")).toBe(replacement);
  expect(f.missing).not.toHaveBeenCalled();
  expect(f.native).toHaveBeenCalledTimes(2);
});

it("releases the exact late native subscription after disposal", async () => {
  const f = fixture();
  let resolve!: (stop: () => void) => void;
  f.peer.listenDestroyed = vi.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  f.observe(record());
  await flush();
  f.owner.dispose();
  const stop = vi.fn();
  resolve(stop);
  await flush();
  expect(stop).toHaveBeenCalledOnce();
  expect(f.missing).not.toHaveBeenCalled();
});

it("keeps failed enumeration unknown and stops bounded retries until visibility or new evidence", async () => {
  const f = fixture();
  const original = record();
  f.native.mockRejectedValue(new Error("native unavailable"));
  f.observe(original);
  await flush();
  await vi.advanceTimersByTimeAsync(100_000);
  await flush();
  expect(f.native).toHaveBeenCalledTimes(4);
  expect(f.current.get("peer")).toBe(original);
  expect(f.missing).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(100_000);
  expect(f.native).toHaveBeenCalledTimes(4);
  f.visibility(false);
  f.owner.visible();
  await flush();
  expect(f.native).toHaveBeenCalledTimes(4);
  f.visibility(true);
  f.native.mockResolvedValue([f.peer]);
  f.owner.visible();
  await flush();
  expect(f.native).toHaveBeenCalledTimes(5);
});

it("retries a failed physical listen without treating that failure as window death", async () => {
  const f = fixture();
  const original = record();
  f.peer.listenDestroyed = vi
    .fn()
    .mockRejectedValueOnce(new Error("listener unavailable"))
    .mockResolvedValueOnce(vi.fn());
  f.observe(original);
  await flush();
  expect(f.missing).not.toHaveBeenCalled();
  expect(f.current.get("peer")).toBe(original);
  await vi.advanceTimersByTimeAsync(1000);
  await flush();
  expect(f.peer.listenDestroyed).toHaveBeenCalledTimes(2);
  expect(f.missing).not.toHaveBeenCalled();
});

it("bounds a delayed destroy/absence race without treating a same-label live native window as dead", async () => {
  const f = fixture();
  const original = record();
  f.observe(original);
  await flush();
  f.destroyed[0]();
  await flush();
  expect(f.missing).not.toHaveBeenCalled();
  expect(f.current.get("peer")).toBe(original);
  f.native.mockResolvedValue([]);
  await vi.advanceTimersByTimeAsync(1000);
  await flush();
  expect(f.missing).toHaveBeenCalledExactlyOnceWith(original);
});
