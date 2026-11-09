// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BrowserViewFrame } from "../../model/socialActions";
import type { SocialClient } from "../../model/socialClient";
import { LiveBrowserPanel } from "./LiveBrowserPanel";

/**
 * The live view forwards only what the owner does: a click on the image, typed text or an
 * Enter or Tab key. Polling frames never produces input, and a failed input is reported.
 */

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const FRAME: BrowserViewFrame = { jpegBase64: "QUFB", width: 800, height: 600 };

function clientWith(frame: (accountId: string) => Promise<BrowserViewFrame | null>) {
  const browserViewFrame = vi.fn(frame);
  const browserViewInput = vi.fn(
    async (_accountId: string, _event: unknown): Promise<void> => undefined,
  );
  const client = { browserViewFrame, browserViewInput } as unknown as SocialClient;
  return { client, browserViewFrame, browserViewInput };
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

async function mount(client: SocialClient, accountId = "acc") {
  await act(async () => {
    root.render(createElement(LiveBrowserPanel, { client, accountId, onClose: vi.fn() }));
  });
  await settle();
}

function button(text: string): HTMLButtonElement {
  return [...element.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === text,
  )!;
}

function textInput(): HTMLInputElement {
  return element.querySelector<HTMLInputElement>('form input:not([type="hidden"])')!;
}

async function typeInto(value: string) {
  await act(async () => {
    const input = textInput();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  await act(async () => {
    element
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

it("says it is connecting until the first frame arrives, then that the view is live", async () => {
  let release!: (frame: BrowserViewFrame) => void;
  const { client } = clientWith(
    () =>
      new Promise<BrowserViewFrame>((resolve) => {
        release = resolve;
      }),
  );
  await mount(client);
  expect(element.textContent).toContain("Connecting to the browser window…");
  await act(async () => release(FRAME));
  await settle();
  expect(element.textContent).toContain("Live. Click the page to interact.");
  expect(element.querySelector("img")).not.toBeNull();
});

it("requests frames repeatedly without ever sending input by itself", async () => {
  const { client, browserViewFrame, browserViewInput } = clientWith(async () => FRAME);
  await mount(client);
  await advance(3_000);
  expect(browserViewFrame.mock.calls.length).toBeGreaterThanOrEqual(3);
  expect(browserViewFrame).toHaveBeenCalledWith("acc");
  expect(browserViewInput).not.toHaveBeenCalled();
});

it("shows an unavailable message when frames fail and recovers when the Host answers again", async () => {
  let failing = true;
  const { client, browserViewFrame } = clientWith(async () => {
    if (failing) throw new Error("offline");
    return FRAME;
  });
  await mount(client);
  expect(element.textContent).toContain("The live view is unavailable. Try again.");
  expect(element.querySelector("img")).toBeNull();
  failing = false;
  await advance(700);
  expect(browserViewFrame.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(element.textContent).toContain("Live. Click the page to interact.");
});

it("stops requesting frames when the panel unmounts", async () => {
  const { client, browserViewFrame } = clientWith(async () => FRAME);
  await mount(client);
  await act(async () => root.unmount());
  const calls = browserViewFrame.mock.calls.length;
  await advance(5_000);
  expect(browserViewFrame.mock.calls.length).toBe(calls);
  root = createRoot(element);
});

it("restarts the frame requests for the new account when the account changes", async () => {
  const { client, browserViewFrame } = clientWith(async () => FRAME);
  await mount(client, "first");
  await mount(client, "second");
  expect(browserViewFrame).toHaveBeenCalledWith("second");
  browserViewFrame.mockClear();
  await advance(1_500);
  expect(browserViewFrame).not.toHaveBeenCalledWith("first");
  expect(browserViewFrame).toHaveBeenCalledWith("second");
});

it("sends typed text once on submit, clears the field and keeps autofill off", async () => {
  const { client, browserViewInput } = clientWith(async () => FRAME);
  await mount(client);
  expect(element.querySelector("form")?.getAttribute("autocomplete")).toBe("off");
  expect(button("Type").disabled).toBe(true);
  await typeInto("hello there");
  expect(button("Type").disabled).toBe(false);
  await submit();
  expect(browserViewInput).toHaveBeenCalledExactlyOnceWith("acc", {
    type: "type",
    text: "hello there",
  });
  expect(textInput().value).toBe("");
  await submit();
  expect(browserViewInput).toHaveBeenCalledTimes(1);
});

it("sends nothing when the text field is empty", async () => {
  const { client, browserViewInput } = clientWith(async () => FRAME);
  await mount(client);
  await submit();
  expect(browserViewInput).not.toHaveBeenCalled();
});

it("sends Enter and Tab only when the owner presses those buttons", async () => {
  const { client, browserViewInput } = clientWith(async () => FRAME);
  await mount(client);
  expect(browserViewInput).not.toHaveBeenCalled();
  await act(async () => button("Enter").click());
  await settle();
  await act(async () => button("Tab").click());
  await settle();
  expect(browserViewInput.mock.calls).toEqual([
    ["acc", { type: "key", key: "Enter" }],
    ["acc", { type: "key", key: "Tab" }],
  ]);
});

it("keeps the typed text and reports the failure when the input could not be delivered", async () => {
  const { client, browserViewInput } = clientWith(async () => FRAME);
  browserViewInput.mockRejectedValueOnce(new Error("offline"));
  await mount(client);
  await typeInto("keep me");
  await submit();
  expect(element.textContent).toContain("The live view is unavailable. Try again.");
  expect(textInput().value).toBe("keep me");
  expect(button("Type").disabled).toBe(false);
});

it("sends no click when the image has no measurable size", async () => {
  const { client, browserViewInput } = clientWith(async () => FRAME);
  await mount(client);
  const image = element.querySelector("img")!;
  image.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect;
  await act(async () => {
    image.dispatchEvent(
      new MouseEvent("click", { clientX: 5, clientY: 5, detail: 1, bubbles: true }),
    );
  });
  expect(browserViewInput).not.toHaveBeenCalled();
});
