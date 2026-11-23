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

it.each<[StatusTextStatus, string, string]>([
  ["succeeded", "Sent", "done"],
  ["completed", "Completed", "done"],
  ["queued", "Scheduled", "idle"],
  ["running", "Sending", "running"],
  ["failed", "Failed", "failed"],
  ["review", "Needs review", "needs-you"],
  ["cancelled", "Cancelled", "idle"],
  ["delivery", "Waiting for you", "needs-you"],
  ["needs_human", "Waiting for you", "needs-you"],
])("shows status %s as the plain word %s", (status, word, tone) => {
  act(() => root.render(createElement(StatusText, { status })));
  expect(element.textContent).toBe(word);
  // The shared StatusText owns `data-status` and sets it to the tone; the raw code is never exposed.
  expect(element.querySelector("[data-status]")?.getAttribute("data-status")).toBe(tone);
});
