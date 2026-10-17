// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { SlotText } from "./SlotText";
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("preserves the exact latest formatted accessible value across rapid KPI changes", async () => {
  for (const value of ["$12.40", "$8.60", "$190.02"]) {
    await act(async () => root.render(createElement(SlotText, { value, announce: true })));
    expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe(value);
    expect(host.querySelector('[aria-hidden="true"]')).not.toBeNull();
  }
  expect(host.querySelectorAll("[aria-live]")).toHaveLength(1);
});
it("renders a single settled string when application motion is off, including shortened values", async () => {
  for (const value of ["125.2K", "0", "2.4M"]) {
    await act(async () => root.render(createElement(SlotText, { value, motion: "none" })));
    expect(host.textContent).toBe(value);
    expect(host.querySelector("[aria-hidden]")).toBeNull();
    expect(host.querySelector("[style]")).toBeNull();
  }
});
it("keeps number formatting caller owned and announcements opt in", async () => {
  await act(async () =>
    root.render(
      createElement(SlotText, { value: 1200, format: (n) => `${n} tokens`, motion: "none" }),
    ),
  );
  expect(host.textContent).toBe("1200 tokens");
  expect(host.querySelector("[aria-live]")).toBeNull();
});
