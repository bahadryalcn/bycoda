import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Portal } from "../../../shared/ui/Portal";

/** Move a mounted pane between hosts without losing drafts or attachments. */
export function SessionSurface({ host, children }: { host?: HTMLElement; children: ReactNode }) {
  const fallback = useRef<HTMLDivElement>(null);
  const [container] = useState(() => {
    const node = document.createElement("div");
    node.className = "flex h-full min-h-0 min-w-0 flex-1 flex-col";
    return node;
  });
  useLayoutEffect(() => {
    (host ?? fallback.current)?.appendChild(container);
    return () => container.remove();
  }, [host, container]);
  return (
    <>
      <div ref={fallback} className="h-full min-h-0 min-w-0" />
      {/* Pane-hosted portal into the surface container, not an overlay: shared Popover/Modal do not apply. */}
      <Portal target={container}>{children}</Portal>
    </>
  );
}
