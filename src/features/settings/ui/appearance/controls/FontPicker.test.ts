// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { FontPicker } from "./FontPicker";
import type { FontEntry } from "../../../model/fontCatalog";
import { preloadBundledFont } from "../../../model/fontFaceLoader";

const state = vi.hoisted(() => ({ locale: "en" }));
vi.mock("../../../../../shared/i18n", () => ({
  useLocale: () => state.locale,
  t: (key: string) => `${state.locale}:${key}`,
}));
vi.mock("../../../../../shared/ui/SearchableSelect", () => ({
  SearchableSelect: ({
    options,
  }: {
    options: { label: string; group?: string; meta?: string }[];
  }) => createElement("div", null, JSON.stringify(options)),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const host = document.createElement("div");
const root = createRoot(host);
afterEach(() => {
  act(() => root.render(null));
  state.locale = "en";
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "fonts");
});

it("registers previews on demand and preloads the existing faces when the font is applied", () => {
  const add = vi.fn();
  const remove = vi.fn();
  Object.defineProperty(document, "fonts", { configurable: true, value: { add, delete: remove } });
  const load = vi.fn();
  vi.stubGlobal(
    "FontFace",
    class {
      status = "unloaded";
      load() {
        this.status = "loading";
        load();
        return Promise.resolve(this);
      }
    },
  );
  act(() =>
    root.render(
      createElement(FontPicker, {
        label: "Interface font",
        value: "System",
        onChange: vi.fn(),
        catalog: [{ id: "Inter", family: "Inter Variable", category: "modern", bundled: true }],
      }),
    ),
  );
  expect(add).toHaveBeenCalledTimes(2);
  expect(load).not.toHaveBeenCalled();
  preloadBundledFont("Inter Variable");
  preloadBundledFont("Inter Variable");
  expect(add).toHaveBeenCalledTimes(2);
  expect(load).toHaveBeenCalledTimes(2);
  const failedFace = add.mock.calls[0][0];
  failedFace.status = "error";
  preloadBundledFont("Inter Variable");
  expect(remove).toHaveBeenCalledExactlyOnceWith(failedFace);
  expect(add).toHaveBeenCalledTimes(3);
  expect(load).toHaveBeenCalledTimes(3);
});

it("updates font names, categories and tags when language changes without changing the catalog", () => {
  const catalog: FontEntry[] = [
    { id: "System", category: "system", tag: "accessible", bundled: false },
  ];
  const render = () =>
    root.render(
      createElement(FontPicker, {
        label: "Interface font",
        catalog,
        value: "System",
        onChange: vi.fn(),
      }),
    );
  act(render);
  expect(host.textContent).toContain("en:System default");
  state.locale = "tr";
  act(render);
  expect(host.textContent).toContain("tr:System default");
  expect(host.textContent).toContain("tr:System");
  expect(host.textContent).toContain("tr:Accessible");
});
