import { useContext, useEffect, useRef } from "react";
import {
  createPerformanceTraceId,
  isPerformanceTracingEnabled,
  recordPerformanceEvent,
} from "../../../shared/lib/performanceTrace";
import { PerformanceTraceContext } from "./performanceTraceContext";

/**
 * Records when a reply reached the renderer and when it first and last painted,
 * under the submission's trace id. Does nothing unless tracing is enabled.
 */
export function useRenderTrace(
  text: string,
  paintedText: string,
  revealing: boolean,
  streaming: boolean | undefined,
) {
  const submissionTraceId = useContext(PerformanceTraceContext);
  const paintTrace = useRef<string | null>(null);
  const firstPaintRecorded = useRef(false);
  const receivedText = useRef(text);
  useEffect(() => {
    if (!isPerformanceTracingEnabled()) return;
    if (
      firstPaintRecorded.current &&
      receivedText.current === text &&
      paintTrace.current !== submissionTraceId
    )
      return;
    receivedText.current = text;
    if (submissionTraceId && paintTrace.current !== submissionTraceId)
      firstPaintRecorded.current = false;
    paintTrace.current = submissionTraceId ?? paintTrace.current ?? createPerformanceTraceId();
    recordPerformanceEvent("renderer-receive", { items: text.length }, paintTrace.current);
  }, [text, submissionTraceId]);
  useEffect(() => {
    if (!isPerformanceTracingEnabled()) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (!firstPaintRecorded.current) {
          firstPaintRecorded.current = true;
          recordPerformanceEvent(
            "first-paint",
            { items: paintedText.length },
            paintTrace.current ?? undefined,
          );
        }
        if (!streaming && !revealing)
          recordPerformanceEvent(
            "last-paint",
            { items: paintedText.length },
            paintTrace.current ?? undefined,
          );
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [paintedText, revealing, streaming, submissionTraceId]);
}
