// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { HealthDot, type HealthStatus } from "./HealthDot";
import { PlatformBadge } from "./PlatformBadge";

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

it.each<[HealthStatus, string]>([
  ["ok", "success"],
  ["warn", "warning"],
  ["error", "danger"],
])("shows health %s as a %s dot that is announced with its meaning", (status, tone) => {
  act(() => root.render(createElement(HealthDot, { status, label: "Connection check" })));
  const dot = element.querySelector('[role="img"]');
  expect(dot?.getAttribute("aria-label")).toBe("Connection check");
  expect(dot?.getAttribute("data-tone")).toBe(tone);
});

it("names platforms by brand and the email channel as Email", () => {
  act(() => root.render(createElement(PlatformBadge, { platform: "x" })));
  expect(element.textContent).toBe("X");
  act(() => root.render(createElement(PlatformBadge, { platform: "linkedin" })));
  expect(element.textContent).toBe("LinkedIn");
  act(() => root.render(createElement(PlatformBadge, { platform: "email" })));
  expect(element.textContent).toBe("Email");
});
