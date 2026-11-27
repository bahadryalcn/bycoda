import { act } from "react";

/**
 * Opens a shared error's "Details" popover; the raw text is then in the document body. `title`
 * picks one error when several are shown (its Details label names the headline).
 */
export const showErrorDetails = (scope: ParentNode, title?: string) =>
  act(async () =>
    [...scope.querySelectorAll("button")]
      .find((button) =>
        button.getAttribute("aria-label")?.startsWith(title ? `Details: ${title}` : "Details"),
      )!
      .click(),
  );
