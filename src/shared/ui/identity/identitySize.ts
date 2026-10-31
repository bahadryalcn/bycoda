/** Identity glyph sizes on the shared icon scale: 12, 14, 16 and 20px. */
export type IdentitySize = "xs" | "sm" | "md" | "lg";

export const IDENTITY_SIZE_CLASS: Record<IdentitySize, string> = {
  xs: "icon-xs",
  sm: "icon-sm",
  md: "icon-md",
  lg: "icon-lg",
};

/**
 * Class of an identity glyph. With `size` the shared icon scale sets the box and `className` only adds
 * (placement, colour, radius); without it `className` keeps its existing meaning, including the size.
 */
export function identityClassName(
  size: IdentitySize | undefined,
  className: string | undefined,
  fallback: string,
): string {
  if (!size) return className ?? fallback;
  return [IDENTITY_SIZE_CLASS[size], "shrink-0", className].filter(Boolean).join(" ");
}
