// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import trCatalog from "./locales/tr.json";
import { NATIVE_LABEL_KEYS } from "./nativeLabelKeys";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args: { labels: Record<string, string> }) => Promise<void>>(),
  sourceCatalogLoaded: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
// The 838 KB source catalog must stay out of the native label path.
vi.mock("./locales/en.json?raw", () => {
  mocks.sourceCatalogLoaded();
  return { default: "{}" };
});

const rust = (file: string) => readFileSync(join("src-tauri", "src", file), "utf8");
const keys = new Set(NATIVE_LABEL_KEYS);

beforeEach(() => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue(undefined);
  mocks.sourceCatalogLoaded.mockClear();
  Object.assign(window, { __TAURI_INTERNALS__: {} });
});
afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  localStorage.clear();
});

it("lists each native message once", () => {
  expect(keys.size).toBe(NATIVE_LABEL_KEYS.length);
});

it("covers every message the native shell translates", () => {
  const missing: string[] = [];
  const need = (message: string) => {
    if (!keys.has(message)) missing.push(message);
  };
  // The macOS menu: same label shape `scripts/i18n/check-locales.mjs` extracts from menu.rs.
  const menu = rust("menu.rs");
  const build = menu.slice(menu.indexOf("\nfn build("), menu.indexOf("\n#[cfg(test)]"));
  expect(build.length).toBeGreaterThan(1000);
  for (const [, value] of build.matchAll(/"([^"\n]+)"/g)) {
    if (/^[A-Z][A-Za-z ]*(?:…|\+ Stack|\+ Row)?$/.test(value) && !value.startsWith("App:"))
      need(value);
  }
  // Predefined macOS items are retitled by their OS text, plus the name-slot prefixes.
  const language = rust("native_language.rs");
  const prefixes = /for prefix in \[([^\]]+)\]/.exec(language)?.[1].match(/"([^"]+)"/g) ?? [];
  expect(prefixes.length).toBeGreaterThan(0);
  for (const prefix of prefixes) need(`${prefix.slice(1, -1)} {p0}`);
  for (const [, prefix] of rust("tray.rs").matchAll(/menu_text\(\s*"([^"]+)"/g))
    need(`${prefix} {p0}`);
  for (const [, message] of rust("tray/windows.rs").matchAll(/translated\(\s*"([^"]+)"/g))
    need(message);
  const notifications = [...rust("desktop_shortcut.rs").matchAll(/translated\(\s*"([^"]+)"/g)];
  expect(notifications.length).toBeGreaterThan(0);
  for (const [, message] of notifications) need(message);
  expect(missing).toEqual([]);
});

it("sends only the native messages, translated, on every language change", async () => {
  const core = await import("./core");
  await core.languageReady;
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
  const [command, first] = mocks.invoke.mock.calls[0];
  expect(command).toBe("native_language_set");
  expect(Object.keys(first.labels)).toEqual([...NATIVE_LABEL_KEYS]);

  await core.setLanguagePreference("tr");
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
  const turkish = mocks.invoke.mock.calls[1][1].labels;
  expect(Object.keys(turkish)).toEqual([...NATIVE_LABEL_KEYS]);
  const catalog: Record<string, string> = trCatalog;
  for (const key of NATIVE_LABEL_KEYS) expect(turkish[key]).toBe(catalog[key] ?? key);
  expect(Object.values(turkish).some((label, index) => label !== NATIVE_LABEL_KEYS[index])).toBe(
    true,
  );

  await core.setLanguagePreference("de");
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(3));
  expect(Object.keys(mocks.invoke.mock.calls[2][1].labels)).toEqual([...NATIVE_LABEL_KEYS]);
  expect(mocks.sourceCatalogLoaded).not.toHaveBeenCalled();
});
