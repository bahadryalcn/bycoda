import { afterEach, expect, it, vi } from "vitest";
import { observeResize } from "./observeResize";

class FakeObserver {
  static instances: FakeObserver[] = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(readonly callback: (entries: ResizeObserverEntry[]) => void) {
    FakeObserver.instances.push(this);
  }
}

const element = () => ({}) as Element;
const entryFor = (target: Element) => ({ target }) as ResizeObserverEntry;

function install() {
  FakeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeObserver);
}

afterEach(() => vi.unstubAllGlobals());

it("shares one observer across elements and routes entries to their listeners", () => {
  install();
  const first = element();
  const second = element();
  const onFirst = vi.fn();
  const onSecond = vi.fn();
  const stopFirst = observeResize(first, onFirst);
  const stopSecond = observeResize(second, onSecond);
  expect(FakeObserver.instances).toHaveLength(1);
  const [observer] = FakeObserver.instances;
  expect(observer.observe.mock.calls).toEqual([[first], [second]]);

  observer.callback([entryFor(first)]);
  expect(onFirst).toHaveBeenCalledTimes(1);
  expect(onSecond).not.toHaveBeenCalled();

  stopFirst();
  expect(observer.unobserve).toHaveBeenCalledWith(first);
  observer.callback([entryFor(first)]);
  expect(onFirst).toHaveBeenCalledTimes(1);

  stopSecond();
  stopSecond();
  expect(observer.disconnect).toHaveBeenCalledTimes(1);
  observeResize(first, onFirst)();
  expect(FakeObserver.instances).toHaveLength(2);
});

it("gives a late subscriber the last entry and keeps the element observed until all leave", async () => {
  install();
  const target = element();
  const early = vi.fn();
  const late = vi.fn();
  const stopEarly = observeResize(target, early);
  const [observer] = FakeObserver.instances;
  const entry = entryFor(target);
  observer.callback([entry]);

  const stopLate = observeResize(target, late);
  expect(observer.observe).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  expect(late).toHaveBeenCalledWith(entry);
  expect(early).toHaveBeenCalledTimes(1);

  stopEarly();
  expect(observer.disconnect).not.toHaveBeenCalled();
  observer.callback([entry]);
  expect(late).toHaveBeenCalledTimes(2);
  stopLate();
  expect(observer.disconnect).toHaveBeenCalledTimes(1);
});

it("skips a late first entry after an immediate unsubscribe and survives a throwing listener", async () => {
  install();
  const target = element();
  const healthy = vi.fn();
  const stopBroken = observeResize(target, () => {
    throw new Error("boom");
  });
  const stopHealthy = observeResize(target, healthy);
  const [observer] = FakeObserver.instances;
  const rethrown: unknown[] = [];
  vi.stubGlobal("queueMicrotask", (task: () => void) => {
    try {
      task();
    } catch (error) {
      rethrown.push(error);
    }
  });
  observer.callback([entryFor(target)]);
  expect(healthy).toHaveBeenCalledTimes(1);
  expect(rethrown).toHaveLength(1);

  const queued: (() => void)[] = [];
  vi.stubGlobal("queueMicrotask", (task: () => void) => queued.push(task));
  const cancelled = vi.fn();
  observeResize(target, cancelled)();
  for (const task of queued) task();
  expect(queued).toHaveLength(1);
  expect(cancelled).not.toHaveBeenCalled();
  stopBroken();
  stopHealthy();
});

it("is a no-op where ResizeObserver does not exist", () => {
  vi.stubGlobal("ResizeObserver", undefined);
  expect(() => observeResize(element(), vi.fn())()).not.toThrow();
});
