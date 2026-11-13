// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import { SaveLookButton } from "./SaveLookButton";
import {
  readGeneratorValue,
  resetGeneratorSession,
  writeGeneratorValue,
} from "./themeGeneratorSession";

const save = vi.hoisted(() => vi.fn(async () => true));
vi.mock("./savedThemeActions", () => ({ saveCurrentLook: save }));
vi.mock("../../../model/savedThemes", async (original) => ({
  ...(await original<object>()),
  useSavedThemes: () => [],
}));

const container = document.createElement("div");
document.body.append(container);
const root = createRoot(container);
afterEach(() => {
  act(() => root.render(null));
  resetGeneratorSession();
  save.mockClear();
});

it("prefills every save entry with the selected name and keeps it editable", async () => {
  writeGeneratorValue("selectedLookName", "Siyah Ufuk", "");
  act(() => root.render(createElement(SaveLookButton, { appearance: {} as AppearanceSettings })));
  act(() => container.querySelector<HTMLButtonElement>("button")!.click());
  const input = document.querySelector<HTMLInputElement>("input[maxlength]")!;
  expect(input.value).toBe("Siyah Ufuk");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, "Gece");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(save).toHaveBeenCalledWith(expect.anything(), "Gece");
  expect(readGeneratorValue("selectedLookName", "")).toBe("Gece");
});

it("opens an unnamed handmade look with an empty editable name", () => {
  act(() =>
    root.render(
      createElement(SaveLookButton, { appearance: {} as AppearanceSettings, card: true }),
    ),
  );
  act(() => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(document.querySelector<HTMLInputElement>("input[maxlength]")!.value).toBe("");
});

it("explains that a pending generated image is excluded while keeping Save available", async () => {
  writeGeneratorValue("chipImages", { 0: { status: "loading" } }, {});
  act(() =>
    root.render(
      createElement(SaveLookButton, {
        appearance: {} as AppearanceSettings,
      }),
    ),
  );
  act(() => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(document.body.textContent).toContain(
    "The image is still generating. This saves your current look without the pending image.",
  );
  const input = document.querySelector<HTMLInputElement>("input[maxlength]")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, "Current look");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(save).toHaveBeenCalledWith(expect.anything(), "Current look");
});
