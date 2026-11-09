// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { TechnicalDetails } from "./TechnicalDetails";

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  act(() =>
    root.render(createElement(TechnicalDetails, null, createElement("code", null, "job-123"))),
  );
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

it("keeps ids and raw payloads closed by default", () => {
  const toggle = element.querySelector("button")!;
  expect(toggle.textContent?.trim()).toBe("Technical details");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(element.textContent).not.toContain("job-123");
});

it("opens and closes the body from the toggle and links the two", () => {
  const toggle = element.querySelector("button")!;
  act(() => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  const body = element.querySelector(".social-technical-details-body");
  expect(body?.textContent).toBe("job-123");
  expect(toggle.getAttribute("aria-controls")).toBe(body?.id);
  act(() => toggle.click());
  expect(element.textContent).not.toContain("job-123");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
});
