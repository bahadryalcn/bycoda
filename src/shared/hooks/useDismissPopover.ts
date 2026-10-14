import { useCallback, useEffect, useRef, type RefObject } from "react";

/** Restore keyboard focus after the dismissed popover has left the DOM. */
export function useDismissPopover(
  setOpen: (open: boolean) => void,
  trigger: RefObject<HTMLElement | null>,
) {
  const frame = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    [],
  );
  return useCallback(
    (reason: string) => {
      setOpen(false);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      if (reason === "escape")
        frame.current = requestAnimationFrame(() => trigger.current?.focus());
    },
    [setOpen, trigger],
  );
}
