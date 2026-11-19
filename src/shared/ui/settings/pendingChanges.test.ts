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

it("publishes only when a visible change field or the change order differs, not for rebuilt equal changes", async () => {
  const listener = vi.fn();
  const stop = subscribePendingSources(listener);
  const base: PendingChange = { id: "one", label: "Effort", scope: "Claude Code", detail: "Low → High" };
  await mount(source({ changes: [{ ...base }] }));
  expect(listener).toHaveBeenCalledTimes(1);
  await mount(source({ changes: [{ ...base }], save: vi.fn() }));
  expect(listener).toHaveBeenCalledTimes(1);
  await mount(source({ changes: [{ ...base, detail: "Low → Medium" }] }));
  expect(listener).toHaveBeenCalledTimes(2);
  await mount(source({ changes: [{ ...base, detail: "Low → Medium", scope: "Codex" }] }));
  expect(listener).toHaveBeenCalledTimes(3);
  await mount(
    source({ changes: [{ ...base, detail: "Low → Medium", scope: "Codex", label: "Mode" }] }),
  );
  expect(listener).toHaveBeenCalledTimes(4);
  await mount(source({ changes: [{ ...base }, change("two")] }));
  expect(listener).toHaveBeenCalledTimes(5);
  await mount(source({ changes: [change("two"), { ...base }] }));
  expect(listener).toHaveBeenCalledTimes(6);
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

it("saveAllPending is false when the editor does not acknowledge the save, whatever the registry shows", async () => {
  const unacknowledged = source({ save: vi.fn() });
  await mount(unacknowledged);
  expect(await saveAllPending()).toBe(false);
  expect(unacknowledged.save).toHaveBeenCalledOnce();
  const refused = source({ save: vi.fn(async () => mount(null).then(() => false)) });
  await mount(refused);
  expect(await saveAllPending()).toBe(false);
});

it("saveAllPending resolves on the acknowledgment alone, without a timer or the registry clearing", async () => {
  const acknowledged = source({ save: vi.fn(async () => true) });
  await mount(acknowledged);
  vi.useFakeTimers();
  try {
    // The draft still shows as unsaved here; only the acknowledgment counts.
    expect(await saveAllPending()).toBe(true);
    expect(pendingSources().map((entry) => entry.id)).toEqual(["a"]);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("saveAllPending keeps every draft and later sources when a save throws or is refused", async () => {
  const first = source({ id: "first", save: vi.fn(async () => true) });
  const failing = source({
    id: "failing",
    save: vi.fn(async () => {
      throw new Error("Host unavailable");
    }),
  });
  const later = source({ id: "later", save: vi.fn(async () => true) });
  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        createElement(Probe, { value: first }),
        createElement(Probe, { value: failing }),
        createElement(Probe, { value: later }),
      ),
    ),
  );
  expect(await saveAllPending()).toBe(false);
  expect(first.save).toHaveBeenCalledOnce();
  expect(failing.save).toHaveBeenCalledOnce();
  expect(later.save).not.toHaveBeenCalled();
  expect(pendingSources().map((entry) => entry.id)).toEqual(["first", "failing", "later"]);
  expect(first.discard).not.toHaveBeenCalled();
});

it("saveAllPending does not acknowledge a draft that registered while saving", async () => {
  const late = source({ id: "late" });
  const first = source({
    save: vi.fn(async () => {
      await act(async () =>
        root.render(
          createElement(
            "div",
            null,
            createElement(Probe, { value: source() }),
            createElement(Probe, { value: late }),
          ),
        ),
      );
      return true;
    }),
  });
  await mount(first);
  expect(await saveAllPending()).toBe(false);
  expect(late.save).not.toHaveBeenCalled();
  expect(pendingSources().map((entry) => entry.id)).toContain("late");
});

it("saveAllPending shares one run between simultaneous callers and can run again afterwards", async () => {
  let release: (value: boolean) => void = () => undefined;
  const save = vi.fn(() => new Promise<boolean>((resolve) => (release = resolve)));
  await mount(source({ save }));
  const first = saveAllPending();
  const second = saveAllPending();
  expect(second).toBe(first);
  release(true);
  expect(await first).toBe(true);
  expect(save).toHaveBeenCalledOnce();
  const again = saveAllPending();
  expect(again).not.toBe(first);
  release(false);
  expect(await again).toBe(false);
  expect(save).toHaveBeenCalledTimes(2);
});

it("a source that left the registry before its save ran is not acknowledged", async () => {
  const gone = source({ save: vi.fn() });
  await mount(gone);
  const [registered] = pendingSources();
  await mount(null);
  expect(await registered?.save()).toBe(false);
  expect(gone.save).not.toHaveBeenCalled();
});
