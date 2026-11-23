// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialClient } from "../../model/socialClient";
import { BrowserSettings } from "./BrowserSettings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("../browser/LiveBrowserPanel", () => ({ LiveBrowserPanel: () => null }));

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

const settings = {
  accountId: "a1",
  visibility: "hidden" as const,
  desktopControl: { allowed: false },
};

function button(text: string) {
  return [...element.querySelectorAll("button")].find((node) => node.textContent === text);
}

it("starts with the window hidden and no desktop control", async () => {
  const get = vi.fn(async () => settings);
  const client = { browser: { settings: { get, set: vi.fn() } } } as unknown as SocialClient;
  act(() =>
    root.render(
      createElement(BrowserSettings, {
        client,
        accountId: "a1",
        accountName: "Studio",
        needsHuman: false,
        disabled: false,
      }),
    ),
  );
  await act(async () => undefined);
  expect(get).toHaveBeenCalledWith("a1");
  expect(element.textContent).toContain("Hidden (recommended)");
  act(() => element.querySelector<HTMLButtonElement>('button[aria-label="Help"]')!.click());
  expect(document.body.textContent).toContain(
    "Desktop control runs only when you're away and on another computer.",
  );
  expect(button("Save browser settings")?.disabled).toBe(true);
});

it("keeps save disabled without a reason until a setting changes", async () => {
  const client = {
    browser: { settings: { get: vi.fn(async () => settings), set: vi.fn() } },
  } as unknown as SocialClient;
  act(() =>
    root.render(
      createElement(BrowserSettings, {
        client,
        accountId: "a1",
        accountName: "Studio",
        needsHuman: false,
        disabled: false,
      }),
    ),
  );
  await act(async () => undefined);
  expect(element.textContent).not.toContain("No changes to save.");
  const save = [...element.querySelectorAll("button")].find(
    (node) => node.textContent === "Save browser settings",
  );
  expect(save?.disabled).toBe(true);
});
