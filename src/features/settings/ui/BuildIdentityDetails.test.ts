// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ copy: vi.fn(), native: null as unknown }));
vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: mock.copy }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => mock.native }));
import { BuildIdentityDetails } from "./BuildIdentityDetails";
let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  vi.clearAllMocks();
});
it("copies the native receipt separately and leaves an unstamped renderer unknown", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.native = { buildId: "native-build", branch: "feature", head: "abcd1234" };
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(createElement(BuildIdentityDetails)));
  cleanup = () => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  };
  expect(container.textContent).toContain("source identity unknown");
  expect(container.textContent).toContain("native-build");
  await act(async () => container.querySelector("button")!.click());
  expect(JSON.parse(mock.copy.mock.calls[0][0])).toEqual({ renderer: null, native: mock.native });
  expect(container.textContent).toContain("Copied");
});
