import { t } from "../../../shared/i18n";
import { formatRelativeTime } from "../../../shared/i18n/format";
import { sanitizeConnectionError } from "./remoteConnection";
import { classifyRemoteError } from "./remoteFailure";

/** The parts of the sync status this summary reads (structurally the sync feature's status). */
export type SyncSummaryInput = {
  state: "idle" | "syncing" | "ok" | "error" | "unsupported" | "unlinked";
  lastSyncAt?: number;
  lastError?: string;
  pendingOps: number;
};

export type SyncSummary = { tone: "muted" | "warning" | "danger"; text: string };

function core(status: SyncSummaryInput, now: number): SyncSummary {
  switch (status.state) {
    case "ok":
      return {
        tone: "muted",
        text: status.lastSyncAt
          ? t("Synced {p0}", { p0: formatRelativeTime(status.lastSyncAt, { now }) })
          : t("Synced"),
      };
    case "syncing":
      return { tone: "muted", text: t("Syncing…") };
    case "unsupported":
      return { tone: "warning", text: t("Sync is unavailable. Update the host on this machine.") };
    case "unlinked":
      return { tone: "warning", text: t("Sync is not linked yet.") };
    case "error": {
      const kind = status.lastError ? classifyRemoteError(status.lastError).kind : "other";
      if (kind === "unreachable" || kind === "temporary") {
        return {
          tone: "warning",
          text: t("Sync is paused because this machine did not answer. It retries automatically."),
        };
      }
      const detail = status.lastError ? sanitizeConnectionError(status.lastError) : "";
      return {
        tone: "danger",
        text: t("Sync failed: {p0}", { p0: detail || t("unknown error") }),
      };
    }
    default:
      return { tone: "muted", text: t("Sync has not run yet") };
  }
}

/** One calm line for a machine's sync state; only a real failure is danger. */
export function summarizeSync(status: SyncSummaryInput, now: number): SyncSummary {
  const summary = core(status, now);
  if (status.pendingOps <= 0) return summary;
  return {
    ...summary,
    text: `${summary.text} · ${t("{p0} pending changes", { p0: status.pendingOps })}`,
  };
}
