/** Written by `RecoveryBoundary` in `src/shared/ui`; read here so the report can include it. */
export const LAST_RENDER_ERROR_KEY = "bycoda.diagnostics.lastRenderError";
const REPORTED_KEY = "bycoda.diagnostics.lastReportedRenderError";

export type RenderError = { message: string; componentStack: string; at: string };

export function readRenderError(): RenderError | null {
  try {
    const raw = localStorage.getItem(LAST_RENDER_ERROR_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<RenderError>;
    if (typeof value.at !== "string" || Number.isNaN(Date.parse(value.at))) return null;
    return {
      message: typeof value.message === "string" ? value.message : "",
      componentStack: typeof value.componentStack === "string" ? value.componentStack : "",
      at: value.at,
    };
  } catch {
    return null;
  }
}

/** A render error newer than the last one that was reported or dismissed. */
export function unreportedRenderError(): RenderError | null {
  const error = readRenderError();
  if (!error) return null;
  try {
    const reported = Date.parse(localStorage.getItem(REPORTED_KEY) ?? "");
    if (!Number.isNaN(reported) && Date.parse(error.at) <= reported) return null;
  } catch {
    // -- unreadable storage: treat it as unreported.
  }
  return error;
}

export function markRenderErrorReported(error: RenderError): void {
  try {
    localStorage.setItem(REPORTED_KEY, error.at);
  } catch {
    // -- the next start may offer it again; nothing is lost.
  }
}
