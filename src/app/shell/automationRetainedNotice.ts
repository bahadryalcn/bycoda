import { t } from "../../shared/i18n";

/** Notice for an automation session whose folder placement did not complete cleanly. */
export function automationRetainedNotice(detail: {
  sessionId: string;
  error?: string;
  result?: { state: string; operationId?: string };
}): string {
  const p0 = detail.sessionId;
  if (detail.result?.state === "unknown")
    return t("Automation session {p0} retained; folder outcome is unknown: {p1}", {
      p0,
      p1: detail.result.operationId,
    });
  if (detail.result?.state === "applied-unavailable")
    return t("Automation session {p0} retained; folder change was applied but refresh failed.", {
      p0,
    });
  return detail.error
    ? t("Automation session {p0} retained; folder placement needs review: {p1}", {
        p0,
        p1: detail.error,
      })
    : t("Automation session {p0} retained; folder placement needs review.", { p0 });
}
