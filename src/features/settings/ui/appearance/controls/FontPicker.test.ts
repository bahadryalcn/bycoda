// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { FontPicker } from "./FontPicker";
import type { FontEntry } from "../../../model/fontCatalog";

const state = vi.hoisted(() => ({ locale: "en" }));
vi.mock("../../../../../shared/i18n", () => ({
  useLocale: () => state.locale,
  t: (key: string) => `${state.locale}:${key}`,
}));
vi.mock("../../../model/fontFaceLoader", () => ({ preloadBundledFont: vi.fn() }));
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
