import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("../../shared/lib/productIdentity", () => ({
  PRODUCT_IDENTITY: { displayName: "Test Product", logoSrc: "/test-product.svg" },
}));

import { BootFailure } from "./BootFailure";

it("uses the configured brand in startup recovery without native APIs", () => {
  const markup = renderToStaticMarkup(
    createElement(BootFailure, { error: new Error("Chunk failed"), onRetry: vi.fn() }),
  );
  expect(markup).toContain("Test Product couldn’t start");
  expect(markup).not.toContain("Bycoda");
  expect(markup).toContain('role="alert"');
  expect(markup).toContain("Reload app");
});
