// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { WORKSPACE_BACKGROUND_DEFAULT } from "../../../model/workspaceBackground";
import type { BackgroundGradientSuggestion } from "../../../model/backgroundGradient";
import { GradientStrip } from "./GradientStrip";
import { resetGeneratorSession, writeGeneratorValue } from "./themeGeneratorSession";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./backgroundSuggestionRequest", () => ({ requestBackgroundSuggestion: mocks.request }));
vi.mock("./useThemeGeneratorModel", () => ({
  useThemeGeneratorModel: () => [{ harness: "codex", model: "fixture" }, vi.fn()],
}));
vi.mock("../../../../../integrations/harness", () => ({ canRunHarnessTextPrompt: () => true }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => {
  act(() => root.render(null));
  resetGeneratorSession();
  vi.clearAllMocks();
});

it("keeps a later manual gradient edit when a deferred generated result arrives", async () => {
  let finish!: (value: BackgroundGradientSuggestion) => void;
  mocks.request.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  writeGeneratorValue("gradientPrompt", "ocean", "");
  const change = vi.fn();
  act(() =>
    root.render(
      createElement(GradientStrip, { value: WORKSPACE_BACKGROUND_DEFAULT, onChange: change }),
    ),
  );
  const generate = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Generate gradient",
  )!;
  act(() => generate.click());
  expect(mocks.request).toHaveBeenCalledOnce();
  const radial = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Radial",
  )!;
  await act(async () => {
    radial.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  expect(change).toHaveBeenLastCalledWith({ style: "radial" });
  change.mockClear();
  await act(async () => {
    finish({
      name: "Generated ocean",
      type: "linear",
      stops: ["#123456", "#234567", "#345678"],
      angle: 70,
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  expect(change).not.toHaveBeenCalled();
});
