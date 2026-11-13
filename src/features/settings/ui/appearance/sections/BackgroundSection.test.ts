// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { APPEARANCE_DEFAULTS } from "../../../model/appearancePreferences";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import { generatorSession } from "../controls/themeGeneratorSession";
import { ChatBackgroundCard } from "./BackgroundSection";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
  invoke: vi.fn(async () => []),
}));
vi.mock("../controls/BackgroundLibrary", () => ({ BackgroundLibrary: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => act(() => root.render(null)));

it.each(["Change image", "Remove", "Reset background settings"])(
  "revokes old generated-image intent on %s",
  async (label) => {
    const choose = vi.fn(async () => "/next.png");
    const remove = vi.fn(async () => {});
    const appearance = {
      preferences: APPEARANCE_DEFAULTS,
      chatBackgroundPath: "/fixture.png",
      chatBackgroundEmptyOpacity: 0.3,
      chatBackgroundSessionOpacity: 0.1,
      chatBackgroundScope: "global",
      chatBackgroundBlur: 0,
      newThreadBackgroundEffect: "none",
      chatBackgroundBusy: false,
      onChooseChatBackground: choose,
      onClearChatBackground: remove,
      onChatBackgroundEmptyOpacity: vi.fn(),
      onChatBackgroundSessionOpacity: vi.fn(),
      onPreferences: vi.fn(),
      onChatBackgroundScope: vi.fn(),
      onChatBackgroundBlur: vi.fn(),
      onNewThreadBackgroundEffect: vi.fn(),
    } as unknown as AppearanceSettings;
    generatorSession.select(1);
    act(() => root.render(createElement(ChatBackgroundCard, { appearance })));
    const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (entry) => entry.getAttribute("aria-label") === label || entry.textContent === label,
    );
    expect(button, label).toBeDefined();
    await act(async () => button!.click());
    expect(generatorSession.selected()).toBeNull();
    if (label === "Change image") expect(choose).toHaveBeenCalledOnce();
    if (label === "Remove") expect(remove).toHaveBeenCalledOnce();
  },
);
