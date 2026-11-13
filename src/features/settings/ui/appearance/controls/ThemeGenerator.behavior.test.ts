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
function button(label: string) {
  const found = [...host.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(label),
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
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(ThemeGenerator, {
        appearance: { onChooseChatBackground: chooseBackground } as never,
      }),
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("only requests an image on explicit command, once while pending, and caches it", async () => {
  const pending = deferred<string>();
  mocks.image.mockReturnValue(pending.promise);
  await act(async () => button("Apply Ocean").click());
  expect(mocks.apply).toHaveBeenCalledOnce();
  expect(mocks.image).not.toHaveBeenCalled();
  await act(async () => {
    const action = button("Generate image");
    action.click();
    action.click();
  });
  expect(mocks.image).toHaveBeenCalledOnce();
  await act(async () => {
    button("None").click();
    generatorSession.invalidateImageIntent();
    pending.resolve("/source.png");
    await pending.promise;
  });
  expect(chooseBackground).not.toHaveBeenCalled();
  await act(async () => writeGeneratorValue("withImage", true, false));
  await act(async () => button("Use image").click());
  expect(chooseBackground).toHaveBeenCalledOnce();
  expect(mocks.image).toHaveBeenCalledOnce();
});
it("retains previous suggestions when refresh fails", async () => {
  mocks.themes.mockRejectedValue(new Error("offline"));
  await act(async () => button("Generate themes").click());
  expect(host.textContent).toContain("Apply Ocean");
  expect(host.textContent).toContain("offline");
});
it("shows failure on the originating result and permits explicit retry", async () => {
  const pending = deferred<string>();
  mocks.image.mockReturnValueOnce(pending.promise).mockReturnValueOnce(new Promise(() => {}));
  await act(async () => {
    button("Apply Ocean").click();
    button("Generate image").click();
  });
  await act(async () => {
    button("Apply Forest").click();
    pending.reject(new Error("provider unavailable"));
    try {
      await pending.promise;
    } catch {}
  });
  expect(host.textContent).toContain("provider unavailable");
  await act(async () => button("Retry image").click());
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
  await act(async () => button("Use image").click());
  expect(typeof chooseBackground.mock.calls.at(-1)?.[1]?.isCurrent).toBe("function");
  generatorSession.invalidateImageIntent();
  await act(async () => {
    pending.resolve("/stored.png");
    await pending.promise;
  });
  expect(applied).toBe(false);
  expect(host.textContent).not.toContain("Could not use the generated image");
  expect(button("Use image")).toBeTruthy();
});
