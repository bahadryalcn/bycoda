import { type HTMLElement, Window } from "happy-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { SecretValueStore } from "../../secrets/secret-store";
import type { BrowserPage } from "../social-browser";
import {
  InstagramLiveProducer,
  instagramLiveActor,
  instagramStreamRef,
  instagramStreamStored,
} from "./instagram-live";

const URL = "rtmps://live-upload.instagram.com:443/rtmp/";
const KEY = "synthetic-stream-key";
const windows: Window[] = [];
afterEach(async () => {
  for (const window of windows.splice(0)) await window.close();
});

function fixture() {
  const dom = new Window({ url: "https://www.instagram.com/" });
  windows.push(dom);
  dom.document.body.innerHTML = `
    <main><h1>Live Producer</h1>
      <input aria-label="Stream URL" value="${URL}">
      <label>Stream key<input value="${KEY}"></label>
      <button>Go live</button>
    </main>`;
  Object.defineProperty(dom.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{}],
  });
  const map = new Map<string, string>();
  const vault: SecretValueStore = {
    async get(key) {
      return map.get(key);
    },
    async set(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
  };
  const verify = vi.fn(async () => {});
  const click = vi.fn(async (selector: string) => {
    dom.document.querySelector<HTMLElement>(selector)?.click();
  });
  const cookies = vi.fn(async () => [
    { name: "ds_user_id", value: "101" },
    { name: "sessionid", value: "synthetic-session" },
  ]);
  const page = {
    evaluate: vi.fn(async (expression: string) => dom.eval(expression) as unknown),
    click,
    cookies,
  } as unknown as BrowserPage;
  const producer = new InstagramLiveProducer(page, verify, vault, "account", "101", "epoch");
  return { producer, vault, page, click, verify, dom };
}

it("captures only the labeled Meta credentials to the store and binds them to the actor and epoch", async () => {
  const { producer, vault } = fixture();
  expect(await producer.capture()).toBeUndefined();
  const saved = await vault.get(instagramStreamRef("account"));
  expect(JSON.parse(saved!)).toMatchObject({ url: URL, key: KEY });
  expect(JSON.stringify(await producer.read())).not.toContain(KEY);
  expect(await instagramStreamStored(vault, "account", "101", "epoch")).toBe(true);
  expect(await instagramStreamStored(vault, "account", "900", "epoch")).toBe(false);
  expect(await instagramStreamStored(vault, "account", "101", "new")).toBe(false);
});

it("refuses an unrelated origin, duplicate fields and raw probe errors", async () => {
  const { producer, vault, dom, page } = fixture();
  dom.document.body.insertAdjacentHTML(
    "beforeend",
    '<input aria-label="Stream key" value="duplicate">',
  );
  await expect(producer.capture()).rejects.toMatchObject({ code: "unsupported" });
  dom.location.href = "https://example.com/";
  await expect(producer.capture()).rejects.toMatchObject({ code: "unsupported" });
  vi.mocked(page.evaluate).mockRejectedValueOnce(new Error(KEY));
  await expect(producer.capture()).rejects.not.toThrow(KEY);
  expect(await vault.get(instagramStreamRef("account"))).toBeUndefined();
});

it("proves the numeric actor on a Producer without navigation and refuses another origin", async () => {
  const { page, dom } = fixture();
  await expect(instagramLiveActor(page)).resolves.toBe("101");
  dom.location.href = "https://example.com/";
  await expect(instagramLiveActor(page)).resolves.toBeUndefined();
});

it("requires authority before an End confirmation and reconciles from the observed Producer state", async () => {
  const { producer, click, dom } = fixture();
  const button = dom.document.querySelector("button")!;
  button.textContent = "End live video";
  click
    .mockImplementationOnce(async () => {
      dom.document.body.insertAdjacentHTML(
        "beforeend",
        '<div role="dialog"><button>End live video</button></div>',
      );
    })
    .mockImplementationOnce(async () => {
      dom.document.querySelector('[role="dialog"]')?.remove();
      button.textContent = "Go live";
    });
  const before = vi.fn(async () => {});
  await producer.control("end", before);
  expect(before).toHaveBeenCalledTimes(2);
  expect(click).toHaveBeenCalledTimes(2);
  expect(await producer.read()).toEqual({ state: "awaiting_stream", canStart: true });
});

it("never retries an unconfirmed start and rechecks authority before the first click", async () => {
  const { producer, click, dom } = fixture();
  const denied = vi.fn(async () => {
    throw new Error("owner denied");
  });
  await expect(producer.control("start", denied)).rejects.toThrow("owner denied");
  expect(click).not.toHaveBeenCalled();
  await producer.control(
    "start",
    vi.fn(async () => {}),
  );
  expect(await producer.read()).toEqual({ state: "unknown", canStart: false });
  await expect(
    producer.control(
      "start",
      vi.fn(async () => {}),
    ),
  ).rejects.toMatchObject({ code: "unknown" });
  expect(click).toHaveBeenCalledOnce();
  dom.document.querySelector("button")!.textContent = "End live video";
  expect(await producer.read()).toEqual({ state: "live", canStart: false });
});
