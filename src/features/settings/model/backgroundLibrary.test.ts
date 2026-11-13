// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useBackgroundLibrary } from "./backgroundLibrary";

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: bridge.invoke,
  convertFileSrc: (path: string) => path,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const host = document.createElement("div");
const root = createRoot(host);
let library: ReturnType<typeof useBackgroundLibrary>;
function Probe() {
  library = useBackgroundLibrary();
  return createElement("div", null, JSON.stringify(library));
}
afterEach(() => {
  act(() => root.render(null));
  vi.clearAllMocks();
});

it("distinguishes a failed read from an empty library and supports retry", async () => {
  bridge.invoke.mockRejectedValueOnce(new Error("Library unavailable"));
  await act(async () => root.render(createElement(Probe)));
  expect(library.loaded).toBe(true);
  expect(library).toMatchObject({ error: "Library unavailable" });
  bridge.invoke.mockResolvedValueOnce([]);
  await act(async () => library.retry());
  expect(library).toMatchObject({ error: null, images: [], loaded: true });
});

it("keeps the newer read when an older request finishes last", async () => {
  let finishOld!: (images: unknown[]) => void;
  bridge.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  await act(async () => root.render(createElement(Probe)));
  bridge.invoke.mockResolvedValueOnce([{ id: "newer", path: "/newer.png" }]);
  await act(async () => library.retry());
  await act(async () => finishOld([{ id: "stale", path: "/stale.png" }]));
  expect(library.images).toMatchObject([{ id: "newer" }]);
});

it("retains the last usable images after a refresh fails", async () => {
  bridge.invoke.mockResolvedValueOnce([{ id: "kept", path: "/kept.png" }]);
  await act(async () => root.render(createElement(Probe)));
  bridge.invoke.mockRejectedValueOnce(new Error("Offline"));
  await act(async () => library.retry());
  expect(library).toMatchObject({ images: [{ id: "kept" }], error: "Offline", loading: false });
});
