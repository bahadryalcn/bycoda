// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialClient } from "../../model/socialClient";
import { LiveBrowserPanel } from "./LiveBrowserPanel";

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

function clientWith(frame: unknown) {
  const browserViewFrame = vi.fn(async () => frame);
  const browserViewInput = vi.fn(async () => undefined);
  const client = { browserViewFrame, browserViewInput } as unknown as SocialClient;
  return { client, browserViewFrame, browserViewInput };
}

async function render(client: SocialClient, onClose = vi.fn()) {
  await act(async () => {
    root.render(createElement(LiveBrowserPanel, { client, accountId: "acc", onClose }));
  });
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  return onClose;
}

it("shows the frame as an image and maps a click to frame pixels", async () => {
  const { client, browserViewInput } = clientWith({ jpegBase64: "QUFB", width: 800, height: 600 });
  await render(client);
  const image = element.querySelector("img");
  expect(image?.getAttribute("src")).toBe("data:image/jpeg;base64,QUFB");
  image!.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 }) as DOMRect;
  await act(async () => {
    image!.dispatchEvent(
      new MouseEvent("click", { clientX: 200, clientY: 150, detail: 1, bubbles: true }),
    );
  });
  expect(browserViewInput).toHaveBeenCalledWith("acc", { type: "click", x: 400, y: 300 });
});

it("sends no click for a keyboard activation of the image, which has no pointer position", async () => {
  const { client, browserViewInput } = clientWith({ jpegBase64: "QUFB", width: 800, height: 600 });
  await render(client);
  const image = element.querySelector("img")!;
  image.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 }) as DOMRect;
  await act(async () => {
    image.dispatchEvent(
      new MouseEvent("click", { clientX: 0, clientY: 0, detail: 0, bubbles: true }),
    );
  });
  expect(browserViewInput).not.toHaveBeenCalled();
});

it("shows the waiting message while the Host has no frame yet and sends no input", async () => {
  const { client, browserViewInput } = clientWith(null);
  await render(client);
  expect(element.textContent).toContain("Waiting for the browser window to start.");
  expect(element.querySelector("img")).toBeNull();
  expect(browserViewInput).not.toHaveBeenCalled();
});

it("closing the panel only calls onClose and sends no input to the browser", async () => {
  const { client, browserViewInput } = clientWith({ jpegBase64: "QUFB", width: 10, height: 10 });
  const onClose = await render(client);
  const close = [...element.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Close view"),
  );
  await act(async () => {
    close?.click();
  });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(browserViewInput).not.toHaveBeenCalled();
});
