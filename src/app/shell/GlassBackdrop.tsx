import type { Ref } from "react";
import { PopupBackdrop } from "../../shared/ui/NativePopupHost";

/**
 * Shell adapter for the shared opaque backdrop.
 */
export function GlassBackdrop({
  className,
  ref,
}: {
  className?: string;
  ref?: Ref<HTMLDivElement>;
}) {
  return <PopupBackdrop ref={ref} className={className} />;
}
