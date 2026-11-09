// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DisabledReason, gateProps } from "./DisabledReason";

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

it("shows the reason as visible text and links it to the disabled button", () => {
  act(() =>
    root.render(
      createElement(
        DisabledReason,
        { disabled: true, reason: "Connect the account first." },
        "Publish",
      ),
    ),
  );
  const reason = element.querySelector(".social-disabled-reason-text");
  const button = element.querySelector("button");
  expect(reason?.textContent).toBe("Connect the account first.");
  expect(button?.disabled).toBe(true);
  expect(button?.getAttribute("aria-describedby")).toContain(reason?.id ?? "missing");
});

it("shows no reason text when the button is enabled", () => {
  const onClick = vi.fn();
  act(() => root.render(createElement(DisabledReason, { onClick }, "Publish")));
  expect(element.querySelector(".social-disabled-reason-text")).toBeNull();
  const button = element.querySelector("button");
  expect(button?.disabled).toBe(false);
  act(() => button?.click());
  expect(onClick).toHaveBeenCalledTimes(1);
});

it("does not run the click handler of a disabled button", () => {
  const onClick = vi.fn();
  act(() =>
    root.render(
      createElement(
        DisabledReason,
        { disabled: true, reason: "Connect the account first.", onClick },
        "Publish",
      ),
    ),
  );
  act(() => element.querySelector("button")?.click());
  expect(onClick).not.toHaveBeenCalled();
});

it("keeps the caller's own description next to the reason", () => {
  act(() =>
    root.render(
      createElement(
        DisabledReason,
        { disabled: true, reason: "Add text first.", "aria-describedby": "caller-help" },
        "Publish",
      ),
    ),
  );
  const reason = element.querySelector(".social-disabled-reason-text");
  const described = element.querySelector("button")?.getAttribute("aria-describedby")?.split(" ");
  expect(described).toContain("caller-help");
  expect(described).toContain(reason?.id ?? "missing");
});

it("turns a gate into the props that require a reason when blocked", () => {
  expect(gateProps({ disabled: true, disabledReason: "Add text first." })).toEqual({
    disabled: true,
    reason: "Add text first.",
  });
  expect(gateProps({ disabled: false })).toEqual({ disabled: false });
  expect(gateProps({})).toEqual({ disabled: false });
});
