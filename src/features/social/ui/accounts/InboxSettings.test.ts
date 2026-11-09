// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialClient } from "../../model/socialClient";
import { InboxSettings } from "./InboxSettings";

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

function render(settings: ReturnType<typeof vi.fn>, enabled: boolean, onChanged = vi.fn()) {
  const client = { inbox: { settings } } as unknown as SocialClient;
  act(() => root.render(createElement(InboxSettings, { client, enabled, onChanged })));
  return onChanged;
}

const toggle = () => element.querySelector<HTMLButtonElement>('[role="switch"]');

it("shows the Host's current setting and writes nothing on open", () => {
  const settings = vi.fn(async () => ({}));
  render(settings, true);
  expect(toggle()?.getAttribute("aria-checked")).toBe("true");
  expect(settings).not.toHaveBeenCalled();
});

it("saves the new automatic refresh value and refreshes the screen", async () => {
  const settings = vi.fn(async () => ({}));
  const onChanged = render(settings, false);
  await act(async () => toggle()?.click());
  expect(settings).toHaveBeenCalledExactlyOnceWith({ autoRefresh: true });
  expect(onChanged).toHaveBeenCalledTimes(1);
});

it("puts the switch back and shows the failure when the Host refuses the change", async () => {
  const settings = vi.fn(async () => {
    throw new Error("The Host is offline.");
  });
  const onChanged = render(settings, false);
  await act(async () => toggle()?.click());
  expect(toggle()?.getAttribute("aria-checked")).toBe("false");
  expect(element.textContent).toContain("The Host is offline.");
  expect(onChanged).not.toHaveBeenCalled();
});

it("follows the Host when the setting changes elsewhere", () => {
  const settings = vi.fn(async () => ({}));
  render(settings, false);
  render(settings, true);
  expect(toggle()?.getAttribute("aria-checked")).toBe("true");
});
