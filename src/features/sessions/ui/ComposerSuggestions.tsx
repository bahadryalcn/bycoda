/** Different job: Editor-attached suggestions preserve composer focus instead of becoming a standalone form field. */
import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { Popover } from "../../../shared/ui/Popover";
import { observeResize } from "../../../shared/lib/observeResize";

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
  matchComposer = false,
  solid = false,
  children,
}: {
  anchor: RefObject<HTMLDivElement | null>;
  below: boolean;
  matchComposer?: boolean;
  /** Keep dense lists readable over chat text and backgrounds. */
  solid?: boolean;
  /** Optional dialog ownership for focused composer pickers; ordinary suggestions stay a list. */
  dialog?: { label: string; onDismiss: (reason: "escape" | "outside") => void };
  children: ReactNode;
}) {
  const [width, setWidth] = useState(anchor.current?.offsetWidth ?? 300);
  // Keep the popup aligned while the composer is resized.
  useLayoutEffect(() => {
    const element = anchor.current;
    if (!element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    return observeResize(element, measure);
  }, [anchor]);
  return (
    <Popover
      anchor={anchor}
      side={below ? "bottom" : "top"}
      width={matchComposer ? width : undefined}
      minWidth={matchComposer ? undefined : width}
      appearance={matchComposer ? "composer" : undefined}
      solid={solid}
      padding={matchComposer ? 4 : undefined}
      gap={4}
      kind={dialog ? "dialog" : undefined}
      aria-label={dialog?.label}
      onDismiss={dialog?.onDismiss}
      className={matchComposer ? "flex flex-col" : "overflow-y-auto overscroll-contain"}
      motion="none"
    >
      {children}
    </Popover>
  );
}
