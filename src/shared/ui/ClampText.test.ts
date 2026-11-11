// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { ClampText } from "./ClampText";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  document.body.innerHTML = "";
});

async function mount(overflowing: boolean, expandable = true) {
  const proto = HTMLElement.prototype;
  Object.defineProperty(proto, "scrollHeight", {
    configurable: true,
    get: () => (overflowing ? 200 : 40),
  });
  Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => 80 });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(createElement(ClampText, { lines: 3, expandable, children: "A long comment" })),
  );
  cleanup = () => act(async () => root.unmount());
  return host;
}

it("keeps the text readable and toggles when the content overflows", async () => {
  const host = await mount(true);
  const body = host.querySelector("[data-clamped]") as HTMLElement;
  expect(body.textContent).toBe("A long comment");
  expect(body.style.getPropertyValue("--clamp-lines")).toBe("3");
  const button = host.querySelector("button") as HTMLButtonElement;
  expect(button.textContent).toBe("Show more");
  expect(button.getAttribute("aria-expanded")).toBe("false");
  await act(async () => button.click());
  expect(host.querySelector("[data-clamped]")).toBeNull();
  expect(host.querySelector("button")?.textContent).toBe("Show less");
  expect(host.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
});

it("renders no toggle when the text fits", async () => {
  const host = await mount(false);
  expect(host.querySelector("button")).toBeNull();
  expect(host.textContent).toBe("A long comment");
});

it("only cuts the text when it is not expandable", async () => {
  const host = await mount(true, false);
  const body = host.querySelector("[data-clamped]") as HTMLElement;
  expect(body.textContent).toBe("A long comment");
  expect(body.style.getPropertyValue("--clamp-lines")).toBe("3");
  expect(host.querySelector("button")).toBeNull();
});
