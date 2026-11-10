// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import { ThemePreview } from "./ThemePreview";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset:${path}` }));

const container = document.createElement("div");
document.body.append(container);
const root = createRoot(container);
afterEach(() => act(() => root.render(null)));

it("shows the current image with active-chat visibility and blur, then removes it when cleared", () => {
  const appearance = {
    chatBackgroundPath: "/library/night.png",
    chatBackgroundSessionOpacity: 0.35,
    chatBackgroundEmptyOpacity: 0.8,
    chatBackgroundBlur: 4,
  } as AppearanceSettings;
  act(() => root.render(createElement(ThemePreview, { appearance })));
  const image = container.querySelector<HTMLImageElement>(".theme-preview-background")!;
  expect(image.src).toContain("asset:/library/night.png");
  expect(image.style.opacity).toBe("0.35");
  expect(image.style.filter).toBe("blur(4px)");
  act(() =>
    root.render(
      createElement(ThemePreview, { appearance: { ...appearance, chatBackgroundScope: "empty" } }),
    ),
  );
  expect(container.querySelector("img")).toBeNull();
  act(() =>
    root.render(
      createElement(ThemePreview, {
        appearance: { ...appearance, chatBackgroundPath: null },
      }),
    ),
  );
  expect(container.querySelector("img")).toBeNull();
});
