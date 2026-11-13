// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const openUrl = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
import { Link } from "./Link";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  openUrl.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const click = (anchor: Element, init: MouseEventInit = {}) =>
  act(() => {
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
  });

it("renders a real anchor and opens external URLs through the opener", () => {
  act(() => root.render(createElement(Link, { href: "https://example.com/a" }, "Docs")));
  const anchor = container.querySelector("a[href]")!;
  expect(anchor.getAttribute("href")).toBe("https://example.com/a");
  expect(anchor.hasAttribute("target")).toBe(false);
  click(anchor);
  expect(openUrl).toHaveBeenCalledWith("https://example.com/a");
});

it("leaves handled, modified and non-external clicks alone", () => {
  const onClick = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
  act(() =>
    root.render(
      createElement(
        "div",
        null,
        createElement(Link, { href: "https://example.com/b", onClick }, "Handled"),
        createElement(Link, { href: "https://example.com/c" }, "Modified"),
        createElement(Link, { href: "#local" }, "Local"),
      ),
    ),
  );
  const [handled, modified, local] = Array.from(container.querySelectorAll("a"));
  click(handled);
  click(modified, { ctrlKey: true });
  click(local);
  expect(onClick).toHaveBeenCalledOnce();
  expect(openUrl).not.toHaveBeenCalled();
});

it("keeps chip presentation opt-in without changing handled anchor activation", () => {
  const onClick = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
  act(() =>
    root.render(
      createElement(
        Link,
        { href: "https://example.com/chip", appearance: "chip", onClick },
        "Chip",
      ),
    ),
  );
  const anchor = container.querySelector("a")!;
  expect(anchor.getAttribute("data-link-appearance")).toBe("chip");
  expect(anchor.hasAttribute("appearance")).toBe(false);
  click(anchor);
  expect(onClick).toHaveBeenCalledOnce();
  expect(openUrl).not.toHaveBeenCalled();
});
