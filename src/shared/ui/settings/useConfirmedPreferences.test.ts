// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useConfirmedPreferences } from "./useConfirmedPreferences";

let root: Root;
let container: HTMLDivElement;
let api: ReturnType<typeof useConfirmedPreferences>;

function Harness() {
  api = useConfirmedPreferences();
  return createElement(
    "div",
    null,
    createElement("section", { "data-row": "a", "data-pending": String(api.pending("a")) }, api.feedback("a")),
    createElement("section", { "data-row": "b", "data-pending": String(api.pending("b")) }, api.feedback("b")),
  );
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const row = (id: string) => container.querySelector(`[data-row="${id}"]`)!;
const retryButton = (id: string) =>
  [...row(id).querySelectorAll("button")].find((node) => node.textContent === "Retry")!;
const click = (node: Element) =>
  act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

/** A host-backed writer: resolves when the test says so and stores the value only on success. */
function hostWriter(store: { value: string }, writes: string[]) {
  return (value: string, gate: ReturnType<typeof deferred<boolean>>) => ({
    write: async () => {
      writes.push(value);
      const ok = await gate.promise;
      if (ok) store.value = value;
      return ok;
    },
    verify: () => store.value === value,
  });
}

it("serializes a quick second change and never reports the first one as a failed save", async () => {
  const store = { value: "initial" };
  const writes: string[] = [];
  const request = hostWriter(store, writes);
  const first = deferred<boolean>();
  const second = deferred<boolean>();
  const confirmed = vi.fn();

  await act(async () => api.commit("a", { ...request("on", first), onConfirmed: () => confirmed("on") }));
  await act(async () => api.commit("a", { ...request("off", second), onConfirmed: () => confirmed("off") }));

  // The second change waits for the first write instead of overlapping it.
  expect(writes).toEqual(["on"]);
  expect(row("a").getAttribute("data-pending")).toBe("true");
  expect(row("a").textContent).toContain("Saving…");

  await act(async () => first.resolve(true));
  expect(writes).toEqual(["on", "off"]);
  expect(row("a").textContent).not.toContain("Could not save changes");
  expect(confirmed).not.toHaveBeenCalled();

  await act(async () => second.resolve(true));
  expect(store.value).toBe("off");
  expect(confirmed.mock.calls).toEqual([["off"]]);
  expect(row("a").getAttribute("data-pending")).toBe("false");
  expect(row("a").textContent).toBe("");
});

it("writes only the newest of several changes made while a save is pending", async () => {
  const store = { value: "initial" };
  const writes: string[] = [];
  const request = hostWriter(store, writes);
  const gates = [deferred<boolean>(), deferred<boolean>(), deferred<boolean>()];

  await act(async () => api.commit("a", request("one", gates[0]!)));
  await act(async () => api.commit("a", request("two", gates[1]!)));
  await act(async () => api.commit("a", request("three", gates[2]!)));
  await act(async () => gates[0]!.resolve(true));
  await act(async () => gates[2]!.resolve(true));

  expect(writes).toEqual(["one", "three"]);
  expect(store.value).toBe("three");
  expect(row("a").textContent).toBe("");
});

it("keeps the failure of the latest value and lets Retry replay that value only", async () => {
  const writes: string[] = [];
  const refuse = (value: string) => ({
    write: () => {
      writes.push(value);
      return false;
    },
  });

  await act(async () => api.commit("a", refuse("one")));
  await act(async () => api.commit("a", refuse("two")));
  expect(row("a").textContent).toContain("Could not save changes");

  await click(retryButton("a"));
  expect(writes).toEqual(["one", "two", "two"]);
});

it("clears the failure when a retry is confirmed and leaves other settings alone", async () => {
  const failing = deferred<boolean>();
  const onConfirmed = vi.fn();
  let attempt = 0;

  await act(async () =>
    api.commit("a", {
      write: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("Host rejected write");
        return true;
      },
      onConfirmed,
    }),
  );
  await act(async () => api.commit("b", { write: () => failing.promise }));
  expect(row("a").textContent).toContain("Could not save changes");
  expect(row("b").getAttribute("data-pending")).toBe("true");
  expect(row("b").textContent).not.toContain("Could not save changes");

  await click(retryButton("a"));
  expect(row("a").textContent).toBe("");
  expect(onConfirmed).toHaveBeenCalledTimes(1);
  expect(row("b").getAttribute("data-pending")).toBe("true");

  await act(async () => failing.resolve(true));
  expect(row("b").textContent).toBe("");
});

it("treats a write that did not reach storage as a failed save", async () => {
  const onConfirmed = vi.fn();
  await act(async () => api.commit("a", { write: () => {}, verify: () => false, onConfirmed }));
  expect(row("a").textContent).toContain("Could not save changes");
  expect(onConfirmed).not.toHaveBeenCalled();
});

it("settles a synchronous writer within the call, without a Saving flash", async () => {
  const onConfirmed = vi.fn();
  await act(async () => {
    api.commit("a", { write: () => true, verify: () => true, onConfirmed });
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });
  expect(row("a").getAttribute("data-pending")).toBe("false");
  expect(row("a").textContent).toBe("");
});
