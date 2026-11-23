import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("../../shared/lib/productIdentity", () => ({
  PRODUCT_IDENTITY: {
    displayName: "Test Product",
    logoSrc: "/test-product.svg",
    logoOnDarkSrc: "/test-product-dark.svg",
    wordmarkSrc: "/test-wordmark.svg",
    wordmarkOnDarkSrc: "/test-wordmark-dark.svg",
  },
}));

import { BootFailure } from "./BootFailure";

it("uses the configured brand in startup recovery without native APIs", () => {
  const markup = renderToStaticMarkup(
    createElement(BootFailure, { error: new Error("Chunk failed"), onRetry: vi.fn() }),
  );
  expect(markup).toContain("Couldn’t start");
  expect(markup).not.toContain("Test Product");
  expect(markup).toContain("Your saved workspace is still available.");
  expect(markup).not.toContain("Bycoda");
  expect(markup).toContain('role="alert"');
  expect(markup).toContain("Reload");
});

it("shows the configured brand lockup above the startup failure", () => {
  const markup = renderToStaticMarkup(
    createElement(BootFailure, { error: new Error("Chunk failed"), onRetry: vi.fn() }),
  );
  expect(markup).toMatch(/src="\/test-product(-dark)?\.svg"/);
  expect(markup).toMatch(/src="\/test-wordmark(-dark)?\.svg"/);
  expect(markup.search(/\/test-product(-dark)?\.svg/)).toBeLessThan(markup.indexOf('role="alert"'));
});
