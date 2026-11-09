import type { ComponentPropsWithRef } from "react";
import { isExternalUrl, openExternal } from "../../platform/tauri/openExternal";

export type LinkProps = ComponentPropsWithRef<"a"> & {
  /** Drop the default link ink and hover underline, for a link that draws its own chip or card. */
  unstyled?: boolean;
};

/**
 * A real `<a href>` for text and chip links. http(s) and mailto URLs open through `openExternal`
 * (never `target="_blank"`); an `onClick` that calls `preventDefault` takes the click over, and
 * modified clicks are left to the platform. Styled as an info-tone link with an underline on hover.
 * @group navigation
 * @use A link inside prose or a chip that must stay a real anchor (markdown, previews, references).
 * @avoid A link-styled action or a standalone navigation row: Button variant="link". Opening a URL from code: openExternal.
 */
export function Link({ href, className, unstyled = false, onClick, ...props }: LinkProps) {
  return (
    <a
      {...props}
      href={href}
      className={
        [unstyled ? "" : "text-(--ui-tone-info-fg) hover:underline", className]
          .filter(Boolean)
          .join(" ") || undefined
      }
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          !href ||
          !isExternalUrl(href) ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        openExternal(href).catch((error) => {
          console.error("Failed to open link:", error);
        });
      }}
    />
  );
}
