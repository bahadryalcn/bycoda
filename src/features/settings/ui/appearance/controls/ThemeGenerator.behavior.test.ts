// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  image: vi.fn(),
  themes: vi.fn(),
  apply: vi.fn(),
  add: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => path,
}));
vi.mock("./themeSuggestionRequest", () => ({
  requestBackgroundImage: mocks.image,
  requestThemeSuggestions: mocks.themes,
  createAppearanceGeneration: () => ({ cancel: mocks.cancel }),
  themeSuggestionFailureDetail: (error: unknown) => (error instanceof Error ? error.message : ""),
}));
vi.mock("./applyThemeSuggestion", () => ({
  applyThemeSuggestion: mocks.apply,
  applyDrawnImageTuning: vi.fn(),
}));
vi.mock("../../../model/backgroundLibrary", () => ({
  addBackgroundLibraryImage: mocks.add,
  libraryImageSrc: (image: { path: string }) => image.path,
  loadCurrentLibraryImageId: () => null,
  subscribeBackgroundLibrary: () => () => {},
}));
vi.mock("./useThemeGeneratorModel", () => ({
  useThemeGeneratorModel: () => [{ harness: "codex", model: "test" }, vi.fn()],
}));
vi.mock("../../../../../integrations/harness", () => ({ canRunHarnessTextPrompt: () => true }));
vi.mock("./SaveLookButton", () => ({ SaveLookButton: () => null }));
vi.mock("../../../../../shared/ui/ImageLightbox", () => ({
  ImageLightbox: ({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) =>
    createElement(
      "div",
      { "data-image-preview": src, "aria-label": alt },
      createElement("button", { onClick: onClose }, "Close preview"),
    ),
}));
vi.mock("./ImageProviderButton", () => ({
  ImageProviderButton: ({ onChange }: { onChange: (value: string) => void }) =>
    createElement("button", { onClick: () => onChange("none") }, "None"),
}));
const { ThemeGenerator } = await import("./ThemeGenerator");
const { resetGeneratorSession, writeGeneratorValue, generatorSession } =
  await import("./themeGeneratorSession");
const suggestions = [
  { name: "Ocean", hue: 180, saturation: 50, accent: "#336699" },
  { name: "Forest", hue: 120, saturation: 40, accent: "#228844" },
];
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const chooseBackground = vi.fn();
const clearBackground = vi.fn();
let chatBackgroundPath: string | null = null;
function button(label: string) {
  const found = [...host.querySelectorAll("button")].find(
    (item) => item.getAttribute("aria-label") === label || item.textContent?.includes(label),
  );
  if (!found) throw new Error(`Missing button ${label}: ${host.textContent}`);
  return found;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  resetGeneratorSession();
  writeGeneratorValue("suggestions", suggestions, []);
  writeGeneratorValue("withImage", true, false);
  writeGeneratorValue("prompt", "ocean", "");
  mocks.add.mockResolvedValue({
    id: "image",
    path: "/image.png",
    source: "generated",
    createdMs: 1,
    bytes: 1,
    prompt: null,
  });
  chooseBackground.mockResolvedValue(true);
  clearBackground.mockResolvedValue(undefined);
  chatBackgroundPath = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render();
});
async function render() {
  await act(async () =>
    root.render(
      createElement(ThemeGenerator, {
        appearance: {
          onChooseChatBackground: chooseBackground,
          onClearChatBackground: clearBackground,
          chatBackgroundPath,
        } as never,
      }),
    ),
  );
}
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("draws once and waits for explicit use after preview", async () => {
  const pending = deferred<string>();
  mocks.image.mockReturnValue(pending.promise);
  await act(async () => {
    button("Apply Ocean").click();
    button("Apply Ocean").click();
  });
  expect(mocks.apply).toHaveBeenCalledTimes(2);
  expect(mocks.image).toHaveBeenCalledOnce();
  expect(clearBackground).not.toHaveBeenCalled();
  await act(async () => {
    pending.resolve("/source.png");
    await pending.promise;
  });
  expect(chooseBackground).not.toHaveBeenCalled();
  await act(async () => button("Preview Ocean").click());
  const preview = host.querySelector("[data-image-preview]");
  expect(preview?.getAttribute("data-image-preview")).toBe("/image.png");
  expect(preview?.getAttribute("aria-label")).toBe("Ocean");
  await act(async () => button("Close preview").click());
  expect(host.querySelector("[data-image-preview]")).toBeNull();
  expect(chooseBackground).not.toHaveBeenCalled();
  await act(async () => button("Use image").click());
  expect(chooseBackground).toHaveBeenCalledOnce();
  expect(mocks.image).toHaveBeenCalledOnce();
});

it("keeps the first preview and installed background while drawing a replacement", async () => {
  const replacement = deferred<string>();
  chatBackgroundPath = "/installed.png";
  await render();
  mocks.image.mockResolvedValueOnce("/first.png").mockReturnValueOnce(replacement.promise);
  await act(async () => button("Apply Ocean").click());
  await act(async () => button("Change image").click());
  await act(async () => button("Preview Ocean").click());
  expect(host.querySelector("[data-image-preview]")?.getAttribute("data-image-preview")).toBe(
    "/image.png",
  );
  await act(async () => button("Close preview").click());
  expect(chooseBackground).not.toHaveBeenCalled();
  expect(clearBackground).not.toHaveBeenCalled();
  mocks.add.mockResolvedValueOnce({ id: "replacement", path: "/replacement.png" });
  await act(async () => replacement.resolve("/source.png"));
  await act(async () => button("Preview Ocean").click());
  expect(host.querySelector("[data-image-preview]")?.getAttribute("data-image-preview")).toBe(
    "/replacement.png",
  );
  expect(chooseBackground).not.toHaveBeenCalled();
});
it("does not apply a drawing after the owner moved to another look", async () => {
  const pending = deferred<string>();
  mocks.image.mockReturnValueOnce(pending.promise).mockReturnValueOnce(new Promise(() => {}));
  await act(async () => button("Apply Ocean").click());
  await act(async () => {
    button("Apply Forest").click();
    pending.resolve("/source.png");
    await pending.promise;
  });
  expect(chooseBackground).not.toHaveBeenCalled();
  expect(mocks.image).toHaveBeenCalledTimes(2);
});
it("removes the previous look's image when the new look has none", async () => {
  await act(async () => writeGeneratorValue("withImage", false, false));
  chatBackgroundPath = "/old.png";
  await render();
  await act(async () => button("Apply Ocean").click());
  expect(mocks.apply).toHaveBeenCalledOnce();
  expect(clearBackground).toHaveBeenCalledOnce();
  expect(mocks.image).not.toHaveBeenCalled();
});
it("retains previous suggestions when refresh fails", async () => {
  mocks.themes.mockRejectedValue(new Error("offline"));
  await act(async () => button("Generate themes").click());
  expect(host.textContent).toContain("Ocean");
  expect(host.textContent).toContain("offline");
});
it("tracks an earlier drawing after new suggestions arrive and cancels it independently", async () => {
  const ocean = deferred<string>();
  const forest = deferred<string>();
  mocks.image.mockReturnValueOnce(ocean.promise).mockReturnValueOnce(forest.promise);
  mocks.themes.mockResolvedValue([{ ...suggestions[0], name: "Dawn" }]);
  mocks.cancel.mockResolvedValue(true);
  await act(async () => button("Apply Ocean").click());
  await act(async () => button("Generate themes").click());
  expect(button("Apply Dawn")).toBeTruthy();
  expect(button("Cancel Ocean")).toBeTruthy();
  await act(async () => button("Apply Dawn").click());
  await act(async () => button("Cancel Ocean").click());
  expect(host.textContent).toContain("Cancelled");
  expect(button("Cancel Dawn")).toBeTruthy();
  await act(async () => {
    ocean.resolve("/cancelled.png");
    forest.resolve("/dawn.png");
  });
  expect(mocks.add).toHaveBeenCalledExactlyOnceWith("/dawn.png", expect.anything());
  expect(chooseBackground).not.toHaveBeenCalled();
});
it("keeps a drawing visible when cancellation is unconfirmed", async () => {
  const pending = deferred<string>();
  mocks.image.mockReturnValueOnce(pending.promise);
  mocks.cancel.mockResolvedValueOnce(false);
  await act(async () => button("Apply Ocean").click());
  await act(async () => button("Cancel Ocean").click());
  expect(host.textContent).toContain("Cancellation could not be confirmed.");
  expect(button("Cancel Ocean")).toBeTruthy();
  await act(async () => pending.resolve("/ocean.png"));
  expect(chooseBackground).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Ready");
});

it("previews a finished earlier drawing without applying it to the new theme", async () => {
  const pending = deferred<string>();
  mocks.image.mockReturnValueOnce(pending.promise);
  mocks.themes.mockResolvedValue([{ ...suggestions[0], name: "Dawn" }]);
  await act(async () => button("Apply Ocean").click());
  await act(async () => button("Generate themes").click());
  await act(async () => pending.resolve("/ocean.png"));
  expect(mocks.add).toHaveBeenCalledExactlyOnceWith("/ocean.png", expect.anything());
  expect(chooseBackground).not.toHaveBeenCalled();
  await act(async () => button("Preview Ocean").click());
  expect(host.querySelector("[data-image-preview]")?.getAttribute("aria-label")).toBe("Ocean");
});

it("keeps earlier drawings visible after closing and reopening the generator", async () => {
  const pending = deferred<string>();
  mocks.image.mockReturnValueOnce(pending.promise);
  await act(async () => button("Apply Ocean").click());
  await act(async () => root.render(null));
  await render();
  expect(button("Cancel Ocean")).toBeTruthy();
  await act(async () => pending.resolve("/ocean.png"));
  expect(button("Preview Ocean")).toBeTruthy();
});
it("shows the chosen look's image failure and permits retry", async () => {
  const pending = deferred<string>();
  mocks.image.mockReturnValueOnce(pending.promise).mockReturnValueOnce(new Promise(() => {}));
  await act(async () => button("Apply Ocean").click());
  await act(async () => {
    pending.reject(new Error("provider unavailable"));
    try {
      await pending.promise;
    } catch {}
  });
  expect(host.textContent).toContain("provider unavailable");
  await act(async () => button("Retry").click());
  expect(mocks.image).toHaveBeenCalledTimes(2);
});

it("revokes an explicit image use while its copy is pending", async () => {
  const pending = deferred<string>();
  let applied = false;
  chooseBackground.mockImplementation(async (_path: string, meta: { isCurrent: () => boolean }) => {
    await pending.promise;
    if (!meta.isCurrent()) return null;
    applied = true;
    return "/stored.png";
  });
  await act(async () =>
    writeGeneratorValue(
      "chipImages",
      {
        0: {
          status: "done",
          image: {
            id: "cached",
            path: "/cached.png",
            createdMs: 1,
            bytes: 1,
            source: "generated",
            prompt: null,
          },
        },
      },
      {},
    ),
  );
  await act(async () => button("Apply Ocean").click());
  expect(mocks.image).not.toHaveBeenCalled();
  await act(async () => button("Use image").click());
  expect(typeof chooseBackground.mock.calls.at(-1)?.[1]?.isCurrent).toBe("function");
  generatorSession.invalidateImageIntent();
  await act(async () => {
    pending.resolve("/stored.png");
    await pending.promise;
  });
  expect(applied).toBe(false);
  expect(host.textContent).not.toContain("Could not use the generated image");
  expect(button("Preview Ocean")).toBeTruthy();
});
