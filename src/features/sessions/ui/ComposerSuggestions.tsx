import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { Popover } from "../../../shared/ui/Popover";

/** Keep suggestions attached to the whole input, including after panel resizing. */
export function ComposerSuggestions({
  anchor,
  below,
  children,
}: {
  anchor: RefObject<HTMLDivElement | null>;
  below: boolean;
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
      width={width}
      gap={4}
      className="composer-suggestions overflow-y-auto overscroll-contain"
      style={{ animation: "none" }}
    >
      {children}
    </Popover>
  );
}
