// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(async (_url: string) => undefined),
  openFeedbackDialog: vi.fn(),
}));
vi.mock("../../../platform/tauri/openExternal", () => ({ openExternal: mocks.openExternal }));
vi.mock("../../account", () => ({ openFeedbackDialog: mocks.openFeedbackDialog }));
vi.mock("../../../shared/lib/productIdentity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../shared/lib/productIdentity")>();
  return {
    PRODUCT_IDENTITY: {
      ...actual.PRODUCT_IDENTITY,
      repositoryUrl: "https://github.com/example/bycoda",
    },
  };
});
vi.mock("../../projects/public/contribute", () => ({
  startContribution: vi.fn(async () => undefined),
  useContributeFlow: () => ({ status: "idle" }),
}));
import { GeneralPage } from "./GeneralSettings";
import { SETTINGS_INDEX } from "../model/settings";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const row = (id: string) => container.querySelector<HTMLElement>(`[data-setting-id="${id}"]`);

it("General settings offer Send feedback and the GitHub link, and search finds them", async () => {
  await act(async () => root.render(createElement(GeneralPage, { onOpenWhatsNew: vi.fn() })));
  await act(async () => row("send-feedback")!.querySelector("button")!.click());
  expect(mocks.openFeedbackDialog).toHaveBeenCalledOnce();
  await act(async () => row("star-github")!.querySelector("button")!.click());
  expect(mocks.openExternal).toHaveBeenCalledWith("https://github.com/example/bycoda");
  expect(row("contribute")).not.toBeNull();
  const ids = SETTINGS_INDEX.filter((entry) => entry.section === "general").map((e) => e.id);
  expect(ids).toEqual(expect.arrayContaining(["send-feedback", "star-github", "contribute"]));
});
