// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { StatusText, type StatusTextStatus } from "./StatusText";

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

it.each<[StatusTextStatus, string]>([
  ["succeeded", "Sent"],
  ["queued", "Scheduled"],
  ["running", "Sending"],
  ["failed", "Failed"],
  ["review", "Needs review"],
  ["cancelled", "Cancelled"],
  ["delivery", "Waiting for you"],
  ["needs_human", "Waiting for you"],
])("shows status %s as the plain word %s", (status, word) => {
  act(() => root.render(createElement(StatusText, { status })));
  expect(element.textContent).toBe(word);
  expect(element.querySelector("[data-status]")?.getAttribute("data-status")).toBe(status);
});
