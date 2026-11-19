import type { ComponentPropsWithoutRef } from "react";
import { useColorScheme } from "../hooks/useColorScheme";
import { PRODUCT_IDENTITY } from "../lib/productIdentity";

export type BrandVariant = "mark" | "smallMark" | "wordmark";

/**
 * The fixed-colour asset for a brand variant on a colour scheme: black artwork on light grounds,
 * white artwork on dark. Pure, so the choice is testable without rendering.
 */
export function brandSrc(variant: BrandVariant, scheme: "light" | "dark"): string {
  const onDark = scheme === "dark";
  switch (variant) {
    case "mark":
      return onDark ? PRODUCT_IDENTITY.logoOnDarkSrc : PRODUCT_IDENTITY.logoSrc;
    case "smallMark":
      return onDark ? PRODUCT_IDENTITY.smallLogoOnDarkSrc : PRODUCT_IDENTITY.smallLogoSrc;
    case "wordmark":
      return onDark ? PRODUCT_IDENTITY.wordmarkOnDarkSrc : PRODUCT_IDENTITY.wordmarkSrc;
  }
}

/**
 * The bycoda mark or wordmark as an image in the artwork that matches the active colour scheme.
 * The component owns the variant, so the swap does not depend on the asset path in CSS: a renamed
 * or hashed asset cannot silently leave a dark logo on a dark ground. Empty `alt` (the default) is
 * decorative; pass a name where the mark is the only identity on screen. Other image props pass through.
 *
 * @group media
 * @use Show the bycoda mark or wordmark with artwork for the active color scheme.
 * @avoid Use GithubMark for GitHub identity.
 */
export function BrandMark({
  variant = "mark",
  alt = "",
  ...props
}: { variant?: BrandVariant } & Omit<ComponentPropsWithoutRef<"img">, "src">) {
  const scheme = useColorScheme();
  return <img {...props} alt={alt} src={brandSrc(variant, scheme)} />;
}
