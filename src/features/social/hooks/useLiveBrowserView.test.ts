// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BrowserViewFrame, BrowserViewRead } from "../model/socialActions";
import type { SocialClient } from "../model/socialClient";
import { LIVE_VIEW_MAX_BACKOFF_MS, useLiveBrowserView } from "./useLiveBrowserView";

let element: HTMLDivElement, root: Root, hidden: boolean;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  Reflect.deleteProperty(document, "hidden");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const frameOf = (seq: number, jpegBase64 = `f${seq}`): BrowserViewFrame => ({
  jpegBase64,
  width: 10,
  height: 10,
  seq,
});

type Read = (accountId: string, after?: number) => Promise<BrowserViewRead>;

function clientWith(read: Read) {
  const browserViewFrame = vi.fn(read);
  return { client: { browserViewFrame } as unknown as SocialClient, browserViewFrame };
}

function Probe({ client, accountId }: { client: SocialClient; accountId: string }) {
  const { frame, status, retry } = useLiveBrowserView(client, accountId);
  return createElement(
    "button",
    { onClick: retry, "data-status": status, "data-frame": frame?.jpegBase64 ?? "" },
    "probe",
  );
}

const probe = () => element.querySelector("button")!;

async function mount(client: SocialClient, accountId = "acc") {
  await act(async () => {
    root.render(createElement(Probe, { client, accountId }));
  });
  await settle();
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
}

async function setHidden(value: boolean) {
  hidden = value;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await settle();
}

it("waits twice as long after each failure, up to the cap, and returns to the normal pace after a success", async () => {
  let failing = true;
  const { client, browserViewFrame } = clientWith(async () => {
    if (failing) throw new Error("offline");
    return frameOf(1);
  });
  await mount(client);
  expect(browserViewFrame).toHaveBeenCalledTimes(1);
  expect(probe().dataset.status).toBe("error");
  await advance(1_399);
  expect(browserViewFrame).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(browserViewFrame).toHaveBeenCalledTimes(2);
  await advance(2_800);
  expect(browserViewFrame).toHaveBeenCalledTimes(3);
  // A long outage settles at the cap instead of growing without bound.
  await advance(5_600 + 11_200);
  expect(browserViewFrame).toHaveBeenCalledTimes(5);
  await advance(LIVE_VIEW_MAX_BACKOFF_MS);
  expect(browserViewFrame).toHaveBeenCalledTimes(6);
  failing = false;
  await advance(LIVE_VIEW_MAX_BACKOFF_MS);
  expect(probe().dataset.status).toBe("live");
  await advance(700);
  expect(browserViewFrame).toHaveBeenCalledTimes(8);
});

it("keeps the last picture while reads fail", async () => {
  let failing = false;
  const { client } = clientWith(async () => {
    if (failing) throw new Error("offline");
    return frameOf(1);
  });
  await mount(client);
  expect(probe().dataset.frame).toBe("f1");
  failing = true;
  await advance(700);
  expect(probe().dataset.status).toBe("error");
  expect(probe().dataset.frame).toBe("f1");
});

it("does not read while the document is hidden and reads at once when it is shown again", async () => {
  hidden = true;
  const { client, browserViewFrame } = clientWith(async () => frameOf(1));
  await mount(client);
  await advance(10_000);
  expect(browserViewFrame).not.toHaveBeenCalled();
  await setHidden(false);
  expect(browserViewFrame).toHaveBeenCalledTimes(1);
  await setHidden(true);
  const calls = browserViewFrame.mock.calls.length;
  await advance(10_000);
  expect(browserViewFrame.mock.calls.length).toBe(calls);
});

it("drops a read that finishes after the document was hidden", async () => {
  let release!: (frame: BrowserViewFrame) => void;
  const { client } = clientWith(
    () =>
      new Promise<BrowserViewFrame>((resolve) => {
        release = resolve;
      }),
  );
  await mount(client);
  await setHidden(true);
  await act(async () => release(frameOf(1)));
  await settle();
  expect(probe().dataset.frame).toBe("");
  expect(probe().dataset.status).toBe("connecting");
});

it("never shows the old account's picture after a switch, even when its read finishes late", async () => {
  const releases = new Map<string, (frame: BrowserViewFrame) => void>();
  const { client } = clientWith(
    (accountId) =>
      new Promise<BrowserViewFrame>((resolve) => {
        releases.set(accountId, resolve);
      }),
  );
  await mount(client, "first");
  await mount(client, "second");
  expect(probe().dataset.status).toBe("connecting");
  await act(async () => releases.get("first")!(frameOf(1, "first-picture")));
  await settle();
  expect(probe().dataset.frame).toBe("");
  expect(probe().dataset.status).toBe("connecting");
  await act(async () => releases.get("second")!(frameOf(2, "second-picture")));
  await settle();
  expect(probe().dataset.frame).toBe("second-picture");
});

it("asks for frames after the picture it holds and keeps it when the Host answers unchanged", async () => {
  const answers: BrowserViewRead[] = [frameOf(7), { unchanged: true }];
  const { client, browserViewFrame } = clientWith(
    async () => answers.shift() ?? { unchanged: true },
  );
  await mount(client);
  await advance(700);
  expect(browserViewFrame.mock.calls.map((call) => call[1])).toEqual([undefined, 7]);
  expect(probe().dataset.frame).toBe("f7");
  expect(probe().dataset.status).toBe("live");
});

it("reads again at once on Retry after a failure, without waiting for the backoff", async () => {
  let failing = true;
  const { client, browserViewFrame } = clientWith(async () => {
    if (failing) throw new Error("offline");
    return frameOf(1);
  });
  await mount(client);
  await advance(1_400);
  expect(browserViewFrame).toHaveBeenCalledTimes(2);
  failing = false;
  await act(async () => probe().click());
  await settle();
  expect(browserViewFrame).toHaveBeenCalledTimes(3);
  expect(probe().dataset.status).toBe("live");
});
