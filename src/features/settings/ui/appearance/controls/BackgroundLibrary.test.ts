// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import { BackgroundLibrary } from "./BackgroundLibrary";
import { generatorSession } from "./themeGeneratorSession";

const state = vi.hoisted(() => ({
  library: {
    images: [{ id: "image", path: "/fixture.png", source: "added", prompt: null }],
    currentId: null,
    loaded: true,
    loading: false,
    error: null as string | null,
    retry: vi.fn(),
  },
  save: vi.fn(() => true),
  confirm: vi.fn(),
  themes: [] as { imageId: string; name: string }[],
}));
vi.mock("../../../model/backgroundLibrary", () => ({
  useBackgroundLibrary: () => state.library,
  libraryImageSrc: () => "",
  deleteBackgroundLibraryImage: vi.fn(),
  ensureCurrentLibraryImage: vi.fn(),
}));
vi.mock("../../../model/savedThemes", () => ({
  useSavedThemes: () => [],
  themesUsingImage: (themes: { imageId: string }[], id: string) =>
    themes.filter((theme) => theme.imageId === id),
  loadSavedThemes: () => state.themes,
  dropImageReference: vi.fn((themes) => themes),
  saveSavedThemes: state.save,
}));
vi.mock("../../../../../shared/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: state.confirm, dialog: null }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => {
  act(() => root.render(null));
  state.library.error = null;
  state.library.loaded = true;
  state.library.loading = false;
  state.themes = [];
  vi.clearAllMocks();
});
function render(busy = false, choose = vi.fn(async () => "/fixture.png")) {
  act(() =>
    root.render(
      createElement(BackgroundLibrary, {
        appearance: {
          chatBackgroundBusy: busy,
          chatBackgroundPath: null,
          onChooseChatBackground: choose,
        } as unknown as AppearanceSettings,
      }),
    ),
  );
}

it("shows read failure and retry while keeping existing images", () => {
  state.library.error = "Offline";
  render();
  expect(host.textContent).toContain("Could not load the image library");
  expect(host.querySelector('button[aria-label="Added image"]')).not.toBeNull();
  act(() =>
    [...host.querySelectorAll("button")].find((button) => button.textContent === "Retry")!.click(),
  );
  expect(state.library.retry).toHaveBeenCalledOnce();
});

it("revokes old image intent when applying a library image", async () => {
  const choose = vi.fn(async () => "/fixture.png");
  generatorSession.select(1);
  render(false, choose);
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-label="Added image"]')!.click(),
  );
  expect(generatorSession.selected()).toBeNull();
  expect(choose).toHaveBeenCalledWith("/fixture.png", { libraryId: "image" });
});

it("disables apply and delete while the background is changing", () => {
  render(true);
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="Added image"]')!.disabled).toBe(
    true,
  );
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="Delete image"]')!.disabled).toBe(
    true,
  );
});

it("updates themes added while delete confirmation is open and surfaces a failed reference save", async () => {
  let confirm!: { onConfirm: () => Promise<void> };
  state.confirm.mockImplementationOnce((options) => {
    confirm = options;
    return Promise.resolve();
  });
  render();
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Delete image"]')!.click());
  state.themes = [{ imageId: "image", name: "Added in another window" }];
  state.save.mockReturnValueOnce(false);
  await expect(confirm.onConfirm()).rejects.toThrow("Could not save the theme.");
  expect(state.save).toHaveBeenCalledOnce();
});
