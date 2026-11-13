// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { settingsRevealControl } from "./settingsReveal";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("skips inert, hidden, disabled and non-tabbable controls when revealing a setting", () => {
  const target = document.createElement("div");
  target.innerHTML = `<div class="settings-row-control">
    <div inert><input aria-label="Inert draft"></div>
    <div hidden><button>Hidden</button></div>
    <div aria-hidden="true"><input></div>
    <div aria-disabled="true"><button>Unavailable</button></div>
    <button disabled>Pending</button>
    <button tabindex="-1">Unselected radio</button>
    <button id="available">Available</button>
  </div>`;
  document.body.append(target);
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  expect(settingsRevealControl(target)?.id).toBe("available");
});

it("returns no control for an inactive setting so reveal can focus its row and reason", () => {
  const target = document.createElement("div");
  target.innerHTML = '<div class="settings-row-control" inert><input value="custom"></div>';
  document.body.append(target);
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  expect(settingsRevealControl(target)).toBeUndefined();
  expect(target.querySelector("input")?.value).toBe("custom");
});

it("ignores controls without a rendered rectangle and keeps help outside the control group", () => {
  const target = document.createElement("div");
  target.innerHTML = '<button>Help</button><div class="settings-row-control"><input></div>';
  document.body.append(target);
  expect(settingsRevealControl(target)).toBeUndefined();
});
