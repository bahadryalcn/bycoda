// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";

import { renderPlainBootFallback } from "./plainBootFallback";

beforeEach(() => {
  document.body.innerHTML = '<div id="boot-splash"></div><div id="root"></div>';
});

it("replaces the splash with a message and a working reload button without any imports", () => {
  const reload = vi.fn();
  renderPlainBootFallback(document, new Error("Chunk failed"), reload);

  expect(document.getElementById("boot-splash")).toBeNull();
  const root = document.getElementById("root");
  expect(root?.textContent).toContain("Couldn’t start the app");
  expect(root?.textContent).toContain("Chunk failed");
  root?.querySelector("button")?.click();
  expect(reload).toHaveBeenCalledTimes(1);
});

it("still renders when the root element is missing and the error is not an Error", () => {
  document.body.innerHTML = '<div id="boot-splash"></div>';
  renderPlainBootFallback(document, "locale parse failed", vi.fn());

  expect(document.getElementById("boot-splash")).toBeNull();
  expect(document.body.textContent).toContain("locale parse failed");
  expect(document.querySelector("[data-plain-boot-fallback]")).not.toBeNull();
});
