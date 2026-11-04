// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ label: "quick-composer", listen: vi.fn(), emit: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: mocks.label }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen, emit: mocks.emit }));
vi.mock("../model/quickComposer", () => ({
  QUICK_COMPOSER_SHOWN_EVENT: "shown",
  QUICK_COMPOSER_CATALOG_EVENT: "catalog",
  QUICK_COMPOSER_CATALOG_REQUEST_EVENT: "catalog-request",
  loadQuickProjects: () => ["/repo"],
  initialQuickProject: () => "/repo",
  initialQuickChoice: () => ({ harness: "codex" }),
  applyQuickCatalog: () => ["codex"],
  acceptQuickCatalog: (payload: unknown) => payload,
  requestQuickCatalog: (harness: string) => { void mocks.emit("catalog-request", harness); },
  stopQuickCatalogRequests: () => {},
}));
vi.mock("./QuickProjectIcon", () => ({ loadQuickProjectAppearance: () => ({}) }));
import { useQuickNativeListeners, type QuickNativeListeners } from "./useQuickNativeListeners";

it("dispatches shown only to its panel and broadcasts catalog updates", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  mocks.emit.mockResolvedValue(undefined);
  mocks.listen.mockImplementation(
    async (
      event: string,
      callback: (event: { payload: unknown }) => void,
      options: { target: string },
    ) => {
      handlers.set(`${options.target}:${event}`, callback);
      return () => handlers.delete(`${options.target}:${event}`);
    },
  );
  const shown1 = vi.fn();
  const shown2 = vi.fn();
  const catalog1 = vi.fn();
  const catalog2 = vi.fn();
  const props = (shown: typeof shown1, catalog: typeof catalog1) =>
    ({
      owner: { canMutate: () => true },
      onShown: shown,
      focusPrompt: vi.fn(),
      resetTransient: vi.fn(),
      setProjects: vi.fn(),
      setProjectAppearance: vi.fn(),
      setCwd: vi.fn(),
      setChoice: vi.fn(),
      setModelSettings: vi.fn(),
      setAvailableHarnesses: catalog,
    }) as unknown as QuickNativeListeners;
  const firstProps = props(shown1, catalog1);
  const secondProps = props(shown2, catalog2);
  function First() {
    useQuickNativeListeners(firstProps);
    return null;
  }
  function Second() {
    useQuickNativeListeners(secondProps);
    return null;
  }
  const first = createRoot(document.createElement("div"));
  const second = createRoot(document.createElement("div"));
  try {
    mocks.label = "quick-composer";
    await act(async () => first.render(createElement(First)));
    mocks.label = "quick-composer-git";
    await act(async () => second.render(createElement(Second)));
    mocks.emit.mockClear();
    await act(async () => {
      handlers.get("quick-composer:shown")?.({ payload: null });
      await Promise.resolve();
    });
    expect(shown1).toHaveBeenCalledOnce();
    expect(shown2).not.toHaveBeenCalled();
    expect(mocks.emit).toHaveBeenCalledWith("catalog-request", "codex");
    await act(async () => {
      handlers.get("quick-composer:catalog")?.({ payload: {} });
      handlers.get("quick-composer-git:catalog")?.({ payload: {} });
    });
    expect(catalog1).toHaveBeenCalledOnce();
    expect(catalog2).toHaveBeenCalledOnce();
  } finally {
    await act(async () => {
      first.unmount();
      second.unmount();
    });
    vi.unstubAllGlobals();
  }
});

it("releases late listeners and tolerates failed registration", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let finish!: (release: () => void) => void;
  const release = vi.fn();
  mocks.listen
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error("failed"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const props = {
    owner: { canMutate: () => true },
    onShown: vi.fn(),
    focusPrompt: vi.fn(),
    resetTransient: vi.fn(),
    setProjects: vi.fn(),
    setProjectAppearance: vi.fn(),
    setCwd: vi.fn(),
    setChoice: vi.fn(),
    setModelSettings: vi.fn(),
    setAvailableHarnesses: vi.fn(),
  } as unknown as QuickNativeListeners;
  function Harness() {
    useQuickNativeListeners(props);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => root.unmount());
    await act(async () => {
      finish(release);
      await Promise.resolve();
    });
    expect(release).toHaveBeenCalledOnce();
  } finally {
    warn.mockRestore();
    vi.unstubAllGlobals();
  }
});
