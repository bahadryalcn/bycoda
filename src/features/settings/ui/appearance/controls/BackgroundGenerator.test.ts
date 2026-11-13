// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./backgroundSuggestionRequest", () => ({ requestBackgroundSuggestion: mocks.request }));
vi.mock("./themeSuggestionRequest", () => ({
  themeSuggestionFailureDetail: (error: Error) => error.message,
}));
vi.mock("./useThemeGeneratorModel", () => ({
  useThemeGeneratorModel: () => [
    { harness: "codex", model: "model-a", providerAccountId: "account-a" },
    vi.fn(),
  ],
}));
vi.mock("../../../../../integrations/harness", () => ({ canRunHarnessTextPrompt: () => true }));
const { BackgroundGenerator } = await import("./BackgroundGenerator");
const { resetGeneratorSession, writeGeneratorValue, generatorSession } =
  await import("./themeGeneratorSession");
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const applied = vi.fn();
function mount() {
  root = createRoot(host);
  act(() => root.render(createElement(BackgroundGenerator, { onGenerated: applied })));
}
function click() {
  const button = [...host.querySelectorAll("button")].find((item) =>
    item.textContent?.includes("Generate gradient"),
  );
  if (!button) throw new Error("missing gradient action");
  act(() => button.click());
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetGeneratorSession();
  vi.clearAllMocks();
  writeGeneratorValue("gradientPrompt", "ocean", "");
  host = document.createElement("div");
  document.body.append(host);
  mount();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("retains draft and pending state across remount and ignores completion after a newer look", async () => {
  let resolve!: (value: never) => void;
  mocks.request.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  expect(host.textContent).toContain("model-a");
  expect(host.textContent).toContain("account-a");
  click();
  expect(mocks.request).toHaveBeenCalledWith(
    expect.objectContaining({ harness: "codex", model: "model-a", providerAccountId: "account-a" }),
  );
  act(() => root.unmount());
  mount();
  expect(host.querySelector("input")?.value).toBe("ocean");
  expect(host.querySelector("button[aria-busy=true]")).not.toBeNull();
  generatorSession.invalidateImageIntent();
  await act(async () => resolve({} as never));
  expect(applied).not.toHaveBeenCalled();
});
it("retains actionable failure and draft across remount", async () => {
  mocks.request.mockRejectedValue(new Error("Local host unavailable"));
  await act(async () => click());
  act(() => root.unmount());
  mount();
  expect(host.querySelector("input")?.value).toBe("ocean");
  expect(host.textContent).toContain("Local host unavailable");
  expect(host.textContent).toContain("Try again");
});
