// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  discardAllPending,
  pendingChangeCount,
  pendingSources,
  saveAllPending,
  subscribePendingSources,
  usePendingSource,
  type PendingChange,
  type PendingSource,
} from "./pendingChanges";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const change = (id: string): PendingChange => ({ id, label: id });
const source = (over: Partial<PendingSource> = {}): PendingSource => ({
  id: "a",
  title: "A",
  changes: [change("one")],
  canSave: true,
  save: vi.fn(),
  discard: vi.fn(),
  ...over,
});

function Probe({ value }: { value: PendingSource | null }) {
  usePendingSource(value);
  return null;
}
const mount = (value: PendingSource | null) =>
  act(async () => root.render(createElement(Probe, { value })));

it("refuses save and discard while a storage request is committing", async () => {
  const committing = source({ pending: true });
  await mount(committing);
  expect(await saveAllPending()).toBe(false);
  expect(discardAllPending()).toBe(false);
  expect(committing.save).not.toHaveBeenCalled();
  expect(committing.discard).not.toHaveBeenCalled();
});

it("registers a dirty draft and withdraws it on unmount or when it turns clean", async () => {
  await mount(source());
  expect(pendingSources().map((entry) => entry.id)).toEqual(["a"]);
  expect(pendingChangeCount(pendingSources())).toBe(1);
  await mount(source({ changes: [] }));
  expect(pendingSources()).toEqual([]);
  await mount(source());
  await mount(null);
  expect(pendingSources()).toEqual([]);
  await mount(source());
  await act(async () => root.unmount());
  expect(pendingSources()).toEqual([]);
  root = createRoot(container);
});

it("notifies listeners only when what the owner sees changes, not on every render", async () => {
  const listener = vi.fn();
  const stop = subscribePendingSources(listener);
  await mount(source());
  expect(listener).toHaveBeenCalledTimes(1);
  await mount(source({ save: vi.fn(), discard: vi.fn() }));
  expect(listener).toHaveBeenCalledTimes(1);
  await mount(source({ changes: [change("one"), change("two")] }));
  expect(listener).toHaveBeenCalledTimes(2);
  await mount(source({ changes: [change("one"), change("two")], canSave: false }));
  expect(listener).toHaveBeenCalledTimes(3);
  stop();
});

it("runs the latest save and discard callbacks even when the draft did not publish", async () => {
  const first = source();
  const second = source({ save: vi.fn(), discard: vi.fn() });
  await mount(first);
  await mount(second);
  await saveAllPending();
  discardAllPending();
  expect(first.save).not.toHaveBeenCalled();
  expect(second.save).toHaveBeenCalledOnce();
  expect(second.discard).toHaveBeenCalledOnce();
});

it("saveAllPending is false while a source cannot save and saves nothing", async () => {
  const blocked = source({ canSave: false });
  await mount(blocked);
  expect(await saveAllPending()).toBe(false);
  expect(blocked.save).not.toHaveBeenCalled();
});

it("saveAllPending is false while the draft stays dirty after saving, true once it clears", async () => {
  const stays = source();
  await mount(stays);
  expect(await saveAllPending()).toBe(false);
  expect(stays.save).toHaveBeenCalledOnce();
  await mount(
    source({
      save: () => mount(null),
    }),
  );
  expect(await saveAllPending()).toBe(true);
});
