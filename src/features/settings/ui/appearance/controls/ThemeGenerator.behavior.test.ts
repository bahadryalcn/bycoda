// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ image: vi.fn(), themes: vi.fn(), apply: vi.fn(), add: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => path,
}));
vi.mock("./themeSuggestionRequest", () => ({
  requestBackgroundImage: mocks.image,
  requestThemeSuggestions: mocks.themes,
  themeSuggestionFailureDetail: (error: Error) => error.message,
}));
vi.mock("./applyThemeSuggestion", () => ({
  applyThemeSuggestion: mocks.apply,
  applyDrawnImageTuning: vi.fn(),
}));
vi.mock("../../../model/backgroundLibrary", () => ({
  addBackgroundLibraryImage: mocks.add,
  libraryImageSrc: (image: { path: string }) => image.path,
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
it("draws the chosen look's image once and applies it when it lands", async () => {
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
  expect(chooseBackground).toHaveBeenCalledOnce();
  await act(async () => button("Preview Ocean").click());
  const preview = host.querySelector("[data-image-preview]");
  expect(preview?.getAttribute("data-image-preview")).toBe("/image.png");
  expect(preview?.getAttribute("aria-label")).toBe("Ocean");
  await act(async () => button("Close preview").click());
  expect(host.querySelector("[data-image-preview]")).toBeNull();
  expect(mocks.image).toHaveBeenCalledOnce();
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
  writeGeneratorValue("withImage", false, false);
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
