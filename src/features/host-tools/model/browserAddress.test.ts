// @vitest-environment happy-dom
import { expect, it } from "vitest";
import {
  resolveBrowserAddress,
  validBrowserHome,
  validBrowserSearchTemplate,
} from "./browserAddress";

it("resolves safe URLs and encodes searches without accepting dangerous addresses", () => {
  const search = { engine: "duckduckgo" as const, template: "https://duckduckgo.com/?q={query}" };
  expect(resolveBrowserAddress("https://example.com/a", search)).toBe("https://example.com/a");
  expect(resolveBrowserAddress("cats & dogs", search)).toBe(
    "https://duckduckgo.com/?q=cats%20%26%20dogs",
  );
  expect(resolveBrowserAddress("cats", { ...search, engine: "disabled" })).toBeUndefined();
  for (const bad of [
    "javascript:alert(1)",
    "file:///tmp/a",
    "data:text/plain,x",
    "https://user:pass@example.com",
    "hello\nworld",
  ])
    expect(resolveBrowserAddress(bad, search)).toBeUndefined();
});

it("validates home and custom search templates", () => {
  expect(validBrowserHome("http://localhost:3000")).toBe(true);
  expect(validBrowserHome("https://user@example.com")).toBe(false);
  expect(validBrowserSearchTemplate("https://example.com/?q={query}")).toBe(true);
  for (const bad of [
    "https://example.com/",
    "https://example.com/{query}/{query}",
    "javascript:{query}",
    "https://user@example.com/?q={query}",
    "https://{query}.example.com/search",
  ])
    expect(validBrowserSearchTemplate(bad)).toBe(false);
});

it("rejects expanded search URLs over the allowed length", () => {
  expect(
    resolveBrowserAddress("é".repeat(600), {
      engine: "google",
      template: "https://example.com/?q={query}",
    }),
  ).toBeUndefined();
});
