// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@tauri-apps/api/app");
  vi.doUnmock("./productIdentity");
});

it("uses the configured brand default outside the native runtime", async () => {
  vi.doMock("./productIdentity", () => ({
    PRODUCT_IDENTITY: { displayName: "Test Product", logoSrc: "/test-product.svg" },
  }));
  vi.doMock("@tauri-apps/api/app", () => ({
    getName: async () => {
      throw new Error("not in Tauri");
    },
  }));
  const { FALLBACK_APP_NAME, appName, loadAppName } = await import("./appName");
  expect(FALLBACK_APP_NAME).toBe("Test Product");
  expect(appName()).toBe("Test Product");
  expect(await loadAppName()).toBe("Test Product");
});

it("uses the runtime product name once it resolves", async () => {
  vi.doMock("@tauri-apps/api/app", () => ({
    getName: async () => "Custom Product",
  }));
  const { appName, loadAppName } = await import("./appName");
  expect(await loadAppName()).toBe("Custom Product");
  expect(appName()).toBe("Custom Product");
});

it("keeps the bycoda fallback when the lookup fails or is blank", async () => {
  vi.doMock("@tauri-apps/api/app", () => ({
    getName: async () => {
      throw new Error("not in Tauri");
    },
  }));
  const failing = await import("./appName");
  expect(await failing.loadAppName()).toBe("bycoda");
  vi.resetModules();
  vi.doMock("@tauri-apps/api/app", () => ({ getName: async () => "  " }));
  const blank = await import("./appName");
  expect(await blank.loadAppName()).toBe("bycoda");
});

it.each([
  ["bycoda", "bycoda"],
  ["bycoda Dev", "bycoda Dev"],
  ["bycoda Fork", "bycoda Fork"],
  ["Bycoda", "bycoda"],
  ["Bycoda Dev", "bycoda Dev"],
  ["Bycoda Fork", "bycoda Fork"],
])("adapts native name %s to %s", async (nativeName, displayName) => {
  vi.doMock("@tauri-apps/api/app", () => ({ getName: async () => nativeName }));
  const { appName, loadAppName } = await import("./appName");
  expect(await loadAppName()).toBe(displayName);
  expect(appName()).toBe(displayName);
});

it("useAppName re-renders with the runtime name once it resolves", async () => {
  let resolveName: (name: string) => void = () => {};
  vi.doMock("@tauri-apps/api/app", () => ({
    getName: () => new Promise<string>((resolve) => (resolveName = resolve)),
  }));
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useAppName, loadAppName, FALLBACK_APP_NAME } = await import("./appName");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const seen: string[] = [];
  function Probe() {
    seen.push(useAppName());
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  expect(seen.at(-1)).toBe(FALLBACK_APP_NAME);
  await act(async () => {
    resolveName("Runtime Name");
    await loadAppName();
  });
  expect(seen.at(-1)).toBe("Runtime Name");
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
