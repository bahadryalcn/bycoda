// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TranscriptPool, TranscriptPoolOutlet } from "./TranscriptPool";
import { registerStreamingTextUpdate } from "../model/stableBlocks";
import type { Block } from "../model/session";

function Transcript(_props: { blocks: Block[]; visible?: boolean }) {
  return null;
}

it("does no retention scans for text-only updates of the same visible owner", () => {
  const pool = new TranscriptPool();
  const host = document.createElement("div");
  let blocks = [{ id: "a", role: "assistant", text: "", streaming: true }] as Block[];
  pool.show("a", host, createElement(Transcript, { blocks }));
  // Observe retention methods without adding production counters.
  const retention = pool as unknown as { trim(): void; expire(): void; schedule(): void };
  const spies = [
    vi.spyOn(retention, "trim"),
    vi.spyOn(retention, "expire"),
    vi.spyOn(retention, "schedule"),
  ];
  const entries = (pool as unknown as { entries: Map<string, unknown> }).entries;
  const enumeration = vi.spyOn(entries, "values");
  const membership = pool.getOutletSnapshot();
  try {
    for (let i = 0; i < 40; i++) {
      const next = [{ ...blocks[0], text: `${blocks[0].text}x` }];
      registerStreamingTextUpdate(blocks, next, 0);
      blocks = next;
      pool.show("a", host, createElement(Transcript, { blocks }));
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(enumeration).not.toHaveBeenCalled();
    expect(pool.getOutletSnapshot()).toBe(membership);
    expect(pool.getSnapshot()[0].element.props.blocks).toBe(blocks);
  } finally {
    for (const spy of [...spies, enumeration]) spy.mockRestore();
  }
});

it("keeps LRU snapshots immutable and only notifies the changed portal", () => {
  const pool = new TranscriptPool(1);
  const hosts = [document.createElement("div"), document.createElement("div")];
  const blocks = [{ id: "a", role: "assistant", text: "" }] as Block[];
  pool.show("a", hosts[0], createElement(Transcript, { blocks }));
  pool.show("b", hosts[1], createElement(Transcript, { blocks }));
  const before = pool.getSnapshot();
  const changed = vi.fn();
  const unchanged = vi.fn();
  const off = [
    pool.getEntryStore("a").subscribe(changed),
    pool.getEntryStore("b").subscribe(unchanged),
  ];
  try {
    pool.show(
      "a",
      hosts[0],
      createElement(Transcript, { blocks: [{ ...blocks[0], text: "new" }] }),
    );
    expect(changed).toHaveBeenCalledTimes(1);
    expect(unchanged).not.toHaveBeenCalled();
    expect(before.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(before[0].element.props.blocks).toBe(blocks);
    expect(pool.getSnapshot().map(({ id }) => id)).toEqual(["b", "a"]);
    pool.park("b", hosts[1]);
    pool.park("a", hosts[0]);
    expect(pool.getSnapshot().map(({ id }) => id)).toEqual(["a"]);
  } finally {
    for (const unsubscribe of off) unsubscribe();
  }
});

it("expires due hidden entries during visible updates even without subscribers", () => {
  vi.useFakeTimers();
  try {
    const pool = new TranscriptPool(12, undefined, 100, 0);
    const hosts = [document.createElement("div"), document.createElement("div")];
    const blocks = [] as Block[];
    pool.show("hidden", hosts[0], createElement(Transcript, { blocks }));
    pool.show("hidden", hosts[0], createElement(Transcript, { blocks, visible: false }));
    pool.show("visible", hosts[1], createElement(Transcript, { blocks }));
    vi.advanceTimersByTime(100);
    pool.show("visible", hosts[1], createElement(Transcript, { blocks: [...blocks] }));
    expect(pool.getSnapshot().find(({ id }) => id === "hidden")?.mounted).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it("restores entry notifications after an unsubscribe/resubscribe cycle", () => {
  const pool = new TranscriptPool();
  const host = document.createElement("div");
  const blocks = [] as Block[];
  pool.show("a", host, createElement(Transcript, { blocks }));
  const store = pool.getEntryStore("a");
  const listener = vi.fn();
  store.subscribe(listener)();
  const unsubscribe = store.subscribe(listener);
  try {
    pool.show("a", host, createElement(Transcript, { blocks: [...blocks] }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(pool.getEntryStore("a").read()).toBe(store.read());
  } finally {
    unsubscribe();
  }
});

it("only retains entry listeners while subscribed and reads stable entry snapshots", () => {
  const pool = new TranscriptPool();
  const hosts = [document.createElement("div"), document.createElement("div")];
  const blocks = [] as Block[];
  pool.show("a", hosts[0], createElement(Transcript, { blocks }));
  pool.show("b", hosts[1], createElement(Transcript, { blocks }));
  const stores = (pool as unknown as { entryStores: Map<string, unknown> }).entryStores;
  const store = pool.getEntryStore("a");
  const before = store.read();
  expect(stores.size).toBe(0);
  expect(store.read()).toBe(before);
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  const second = vi.fn();
  const unsubscribeSecond = pool.getEntryStore("a").subscribe(second);
  expect(stores.size).toBe(1);
  unsubscribeSecond();
  expect(stores.size).toBe(1);
  try {
    pool.show("b", hosts[1], createElement(Transcript, { blocks: [...blocks] }));
    expect(listener).not.toHaveBeenCalled();
    expect(store.read()).toBe(before);
    pool.show("a", hosts[0], createElement(Transcript, { blocks: [...blocks] }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(store.read()).not.toBe(before);
    expect(store.read()).toBe(store.read());
  } finally {
    unsubscribe();
  }
  expect(stores.size).toBe(0);
  expect(store.read()).toBe(pool.getSnapshot().find(({ id }) => id === "a"));
});

it("keeps portal subscription callbacks stable across updates without the compiler", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const pool = new TranscriptPool();
  const host = document.createElement("div");
  const root = createRoot(document.createElement("div"));
  const blocks = [] as Block[];
  pool.show("a", host, createElement(Transcript, { blocks }));
  const getEntryStore = pool.getEntryStore.bind(pool);
  const subscribe = vi.fn(getEntryStore("a").subscribe);
  const accessor = vi.spyOn(pool, "getEntryStore").mockImplementation((id) => ({
    ...getEntryStore(id),
    subscribe,
  }));
  try {
    act(() => root.render(createElement(TranscriptPoolOutlet, { pool })));
    for (let i = 0; i < 3; i++)
      act(() => pool.show("a", host, createElement(Transcript, { blocks: [...blocks] })));
    expect(accessor).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    const replacement = new TranscriptPool();
    replacement.show("a", host, createElement(Transcript, { blocks }));
    act(() => root.render(createElement(TranscriptPoolOutlet, { pool: replacement })));
    const stores = (pool as unknown as { entryStores: Map<string, unknown> }).entryStores;
    expect(stores.size).toBe(0);
  } finally {
    act(() => root.unmount());
    accessor.mockRestore();
    vi.unstubAllGlobals();
  }
});
