// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { STOPPING_TIMEOUT_MS } from "../model/backgroundStop";
import { useStopRequests } from "./useStopRequests";

let root: Root;
let requests: ReturnType<typeof useStopRequests>;
function Probe() {
  requests = useStopRequests();
  return null;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("admits one Stop per key before React commits while allowing another target", async () => {
  const run = vi.fn(() => new Promise<void>(() => {}));
  await act(async () => {
    requests.request("one", run);
    requests.request("one", run);
    requests.request("two", run);
  });
  expect(run).toHaveBeenCalledTimes(2);
  expect([...requests.stopping]).toEqual(["one", "two"]);
});

it("ignores a timed-out request's late rejection after a newer Stop starts", async () => {
  let rejectOld!: (error: Error) => void;
  const old = new Promise<void>((_resolve, reject) => {
    rejectOld = reject;
  });
  let rejectNew!: (error: Error) => void;
  const current = new Promise<void>((_resolve, reject) => {
    rejectNew = reject;
  });
  await act(async () => requests.request("one", () => old));
  await act(async () => vi.advanceTimersByTime(STOPPING_TIMEOUT_MS));
  expect(requests.stopping.has("one")).toBe(false);
  await act(async () => requests.request("one", () => current));
  await act(async () => rejectOld(new Error("Old Stop failed")));
  expect(requests.stopping.has("one")).toBe(true);
  expect(requests.failed.has("one")).toBe(false);
  await act(async () => rejectNew(new Error("Current Stop failed")));
  expect(requests.stopping.has("one")).toBe(false);
  expect(requests.failed.has("one")).toBe(true);
});

it("keeps an acknowledged Stop pending until the unconfirmed timeout expires", async () => {
  await act(async () => requests.request("one", async () => {}));
  expect(requests.stopping.has("one")).toBe(true);
  await act(async () => vi.advanceTimersByTime(STOPPING_TIMEOUT_MS));
  expect(requests.stopping.has("one")).toBe(false);
  expect(requests.failed.has("one")).toBe(false);
});

it("reports a synchronous dispatch failure and allows retry", async () => {
  await act(async () =>
    requests.request("one", () => {
      throw new Error("Dispatch failed");
    }),
  );
  expect(requests.stopping.has("one")).toBe(false);
  expect(requests.failed.has("one")).toBe(true);
  await act(async () => requests.request("one", async () => {}));
  expect(requests.stopping.has("one")).toBe(true);
  expect(requests.failed.has("one")).toBe(false);
});
