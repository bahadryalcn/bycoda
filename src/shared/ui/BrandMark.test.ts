import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRODUCT_IDENTITY } from "../lib/productIdentity";
import { brandSrc } from "./BrandMark";

describe("brandSrc", () => {
  it("uses black artwork on light grounds and white artwork on dark", () => {
    expect(brandSrc("mark", "light")).toBe(PRODUCT_IDENTITY.logoSrc);
    expect(brandSrc("mark", "dark")).toBe(PRODUCT_IDENTITY.logoOnDarkSrc);
    expect(brandSrc("smallMark", "light")).toBe(PRODUCT_IDENTITY.smallLogoSrc);
    expect(brandSrc("smallMark", "dark")).toBe(PRODUCT_IDENTITY.smallLogoOnDarkSrc);
    expect(brandSrc("wordmark", "light")).toBe(PRODUCT_IDENTITY.wordmarkSrc);
    expect(brandSrc("wordmark", "dark")).toBe(PRODUCT_IDENTITY.wordmarkOnDarkSrc);
  });

  it("names fixed-colour assets that exist as dedicated files", () => {
    expect(PRODUCT_IDENTITY.logoOnDarkSrc).toBe("/brand/bycoda/mark-white.svg");
    expect(PRODUCT_IDENTITY.smallLogoOnDarkSrc).toBe("/brand/bycoda/mark-small-white.svg");
    expect(PRODUCT_IDENTITY.wordmarkOnDarkSrc).toBe("/brand/bycoda/wordmark-white.svg");
  });
});

describe("bycoda.css brand styling", () => {
  // Regression: theme swaps were keyed on literal asset paths and `content: url()`, which broke silently
  // when an asset was renamed or hashed. The swap now lives in BrandMark, so the stylesheet must not
  // select brand images by `src` again.
  it("does not select brand images by src or swap them with content url", () => {
    const css = readFileSync(new URL("../../styles/bycoda.css", import.meta.url), "utf8");
    expect(css).not.toContain("img[src=");
    expect(css).not.toMatch(/content:\s*url\(\s*"\/brand\//);
  });
});
