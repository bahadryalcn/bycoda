import { resizeComposer } from "../model/composerResize";
import { startPerformanceSpan } from "../../../shared/lib/performanceTrace";
/** Coalesce layout work without delaying text, selection or IME state. */
export function createComposerResizeFrame() {
  let frame: number | null = null;
  let target: HTMLTextAreaElement | null = null;
  return {
    schedule(element: HTMLTextAreaElement) {
      target = element;
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const element = target;
        target = null;
        if (!element?.isConnected) return;
        const end = startPerformanceSpan("composer-resize", { items: element.value.length });
        try {
          resizeComposer(element);
        } finally {
          end();
        }
      });
    },
    cancel() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      target = null;
    },
  };
}
