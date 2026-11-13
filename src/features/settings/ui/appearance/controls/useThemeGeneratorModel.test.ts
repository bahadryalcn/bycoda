// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("../../../../model-routing/public/helpers", () => ({ resolveHelperModel: mocks.resolve }));
vi.mock("../../../../sessions/public/translationPreferences", () => ({
  defaultTextActionChoice: () => ({ harness: "codex", model: "automatic", modelSettings: {} }),
}));
import { useThemeGeneratorModel } from "./useThemeGeneratorModel";
import { resetGeneratorSession } from "./themeGeneratorSession";

let root: ReturnType<typeof createRoot>;
let selection: ReturnType<typeof useThemeGeneratorModel>;
const role = {
  harness: "claude" as const,
  model: "role",
  providerAccountId: "account",
  modelSettings: {},
};
function Probe() {
  selection = useThemeGeneratorModel();
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  resetGeneratorSession();
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it("seeds from the role once and retains an in-place choice across reopening", async () => {
  mocks.resolve.mockResolvedValue(role);
  await act(async () => root.render(createElement(Probe)));
  expect(selection[0]).toEqual(role);
  act(() => selection[1]({ ...role, model: "owner" }));
  act(() => root.unmount());
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
  expect(selection[0].model).toBe("owner");
  expect(mocks.resolve).toHaveBeenCalledOnce();
});

it("never replaces an owner edit with a late role answer", async () => {
  let finish!: (target: typeof role) => void;
  mocks.resolve.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => root.render(createElement(Probe)));
  act(() => selection[1]({ ...role, model: "owner" }));
  await act(async () => finish(role));
  expect(selection[0].model).toBe("owner");
});

it("keeps automatic choice when role resolution falls back", async () => {
  mocks.resolve.mockResolvedValue(undefined);
  await act(async () => root.render(createElement(Probe)));
  expect(selection[0].model).toBe("automatic");
});
