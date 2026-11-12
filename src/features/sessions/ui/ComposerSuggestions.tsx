/** Different job: Editor-attached suggestions preserve composer focus instead of becoming a standalone form field. */
import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { Popover } from "../../../shared/ui/Popover";

/**
 * Keep suggestions attached to the whole input, including after panel resizing.
 * @use Editor-owned suggestions without moving focus away from the composer.
 * @avoid Standalone searchable choices: PickerPopover and PickerList.
 * @replaces An editor-owned overlay frame, not a standalone select controller.
 */
export function ComposerSuggestions({
  anchor,
  below,
  dialog,
  children,
}: {
  anchor: RefObject<HTMLDivElement | null>;
  below: boolean;
  /** Optional dialog ownership for focused composer pickers; ordinary suggestions stay a list. */
  dialog?: { label: string; onDismiss: (reason: "escape" | "outside") => void };
  children: ReactNode;
}) {
  const [width, setWidth] = useState(anchor.current?.offsetWidth ?? 300);
  useLayoutEffect(() => {
    const element = anchor.current;
    if (!element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [anchor]);
  return (
    <Popover
      anchor={anchor}
      side={below ? "bottom" : "top"}
      minWidth={width}
      gap={4}
      kind={dialog ? "dialog" : undefined}
      aria-label={dialog?.label}
      onDismiss={dialog?.onDismiss}
      className="composer-suggestions overflow-y-auto overscroll-contain"
      motion="none"
    >
      {children}
    </Popover>
  );
}
