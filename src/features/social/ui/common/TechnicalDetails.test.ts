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

it("shows ids and raw payloads directly as a helper line without a toggle", () => {
  expect(element.querySelector("button")).toBeNull();
  expect(element.querySelector(".social-technical-details")?.textContent).toBe("job-123");
});
