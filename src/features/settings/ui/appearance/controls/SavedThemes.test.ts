// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import { SavedThemes } from "./SavedThemes";
import {
  readGeneratorValue,
  resetGeneratorSession,
  writeGeneratorValue,
} from "./themeGeneratorSession";

const state = vi.hoisted(() => ({
  rename: vi.fn(() => true),
  themes: [{ id: "night", name: "Siyah Ufuk", createdAt: 1, updatedAt: 1, look: {} }],
}));
vi.mock("./savedThemeActions", () => ({
  renameTheme: state.rename,
  applySavedTheme: vi.fn(),
  deleteTheme: vi.fn(),
  overwriteWithCurrentLook: vi.fn(),
}));
vi.mock("../../../model/savedThemes", async (original) => ({
  ...(await original<object>()),
  useSavedThemes: () => state.themes,
}));
vi.mock("../../../model/backgroundLibrary", () => ({
  useBackgroundLibrary: () => ({ images: [] }),
  libraryImageSrc: () => "",
}));
vi.mock("../../../../../shared/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn(), dialog: null }),
}));
vi.mock("./SaveLookButton", () => ({ SaveLookButton: () => null }));

const container = document.createElement("div");
document.body.append(container);
const root = createRoot(container);

it("blocks saved look application while an image change is pending", () => {
  act(() =>
    root.render(
      createElement(SavedThemes, {
        appearance: {
          themeHue: 220,
          themeSaturation: 12,
          chatBackgroundBusy: true,
        } as AppearanceSettings,
      }),
    ),
  );
  expect(container.querySelector<HTMLButtonElement>(".theme-saved-apply")!.disabled).toBe(true);
});
afterEach(() => {
  act(() => root.render(null));
  resetGeneratorSession();
  state.rename.mockClear();
});

it.each([
  ["Siyah Ufuk", "Gece"],
  ["Other look", "Other look"],
])("renaming a saved theme tracks the name only when selected (%s)", async (selected, expected) => {
  writeGeneratorValue("selectedLookName", selected, "");
  act(() =>
    root.render(
      createElement(SavedThemes, {
        appearance: { themeHue: 220, themeSaturation: 12 } as AppearanceSettings,
      }),
    ),
  );
  act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Rename"]')!.click());
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
  expect(state.rename).toHaveBeenCalledWith("night", "Gece");
  expect(readGeneratorValue("selectedLookName", "")).toBe(expected);
});
