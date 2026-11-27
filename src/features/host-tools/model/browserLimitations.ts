import { t } from "../../../shared/i18n/technical";

/** Translates a limitation the Host browser reports; one literal per known message, unknown text stays as sent. */
export function limitationText(limitation: string): string {
  if (limitation === "No accessible element at this position. Refresh the frame and try again.")
    return t("No accessible element at this position. Refresh the frame and try again.");
  if (
    limitation ===
    "Iframe content (including cross-origin frames) cannot be inspected. Select an element in the main page."
  )
    return t(
      "Iframe content (including cross-origin frames) cannot be inspected. Select an element in the main page.",
    );
  if (limitation === "Shadow DOM content cannot be inspected. Select an element in the main page.")
    return t("Shadow DOM content cannot be inspected. Select an element in the main page.");
  if (limitation === "Layout guides unavailable for transformed, fragmented or large layouts.")
    return t("Layout guides unavailable for transformed, fragmented or large layouts.");
  if (limitation === "Box geometry unavailable for transformed or non-rectangular layout.")
    return t("Box geometry unavailable for transformed or non-rectangular layout.");
  if (
    limitation ===
    "Hover target is opaque or cannot be safely verified. Select an accessible main-page element."
  )
    return t(
      "Hover target is opaque or cannot be safely verified. Select an accessible main-page element.",
    );
  return limitation;
}
