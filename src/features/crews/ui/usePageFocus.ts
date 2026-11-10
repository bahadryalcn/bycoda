import { useEffect, useRef, type RefObject } from "react";

/**
 * Page switches unmount the focused control: Add members focuses its heading and
 * returning to the roster focuses the control that opened it.
 */
export function usePageFocus(pageKind: "team" | "add", body: RefObject<HTMLElement | null>) {
  const firstPage = useRef(true);
  useEffect(() => {
    if (firstPage.current) {
      firstPage.current = false;
      if (pageKind !== "add") return;
    }
    const root = body.current;
    if (pageKind === "add")
      root?.querySelector<HTMLElement>("[data-page-heading]")?.focus({ preventScroll: true });
    else root?.querySelector<HTMLElement>("[data-crew-add]")?.focus();
  }, [pageKind, body]);
}
