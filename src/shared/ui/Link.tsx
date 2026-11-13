import type { ComponentPropsWithRef } from "react";
import { motionAttributes } from "./Motion";
import styles from "./Link.module.css";
import { isExternalUrl, openExternal } from "../../platform/tauri/openExternal";

export type LinkProps = ComponentPropsWithRef<"a"> & {
  /** Drop the default link ink and hover underline, for a link that draws its own chip or card. */
  unstyled?: boolean;
  /** Inline preview chip: transparent ground, shared focus ring and pressed scale. */
  appearance?: "chip";
};

/**
 * A real `<a href>` for text and chip links. http(s) and mailto URLs open through `openExternal`
 * (never `target="_blank"`); an `onClick` that calls `preventDefault` takes the click over, and
 * modified clicks are left to the platform. Styled as an info-tone link with an underline on hover.
 * @group navigation
 * @use A link inside prose or a chip that must stay a real anchor (markdown, previews, references).
 * @avoid A link-styled action or a standalone navigation row: Button variant="link". Opening a URL from code: openExternal. A strip of document tabs: TabStrip.
 */
export function Link({
  href,
  className,
  unstyled = false,
  appearance,
  onClick,
  ...props
}: LinkProps) {
  return (
    <a
      {...props}
      href={href}
      {...(appearance === "chip"
        ? motionAttributes({ transition: "transform", duration: "fast" })
        : {})}
      data-link-appearance={appearance}
      className={
        [
          appearance === "chip"
            ? styles.chip
            : unstyled
              ? ""
              : "text-(--ui-tone-info-fg) hover:underline",
          className,
        ]
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

/**
 * Underline the label of an existing link or Button on pointer hover.
 * @group navigation
 * @use A nested preview/file label whose icon and metadata stay undecorated.
 * @avoid A complete text link: Link already owns its hover underline.
 */
export function linkContentAttributes(className?: string) {
  return { className: [styles.label, className].filter(Boolean).join(" ") };
}
