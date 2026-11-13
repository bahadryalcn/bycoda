import { actionContentAttributes } from "../../../shared/ui/ActionHost";
import { Text } from "../../../shared/ui/Text";
import type { ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { Spinner } from "../../../shared/ui/Spinner";
import { Check, CircleAlert, PenLine } from "../../../shared/ui/icons";
import type { SessionWait } from "../model/sessionWait";
import { SessionWorkingStatus } from "./SessionWorkingStatus";

export type SessionRowStatusKind =
  | "failed"
  | "retrying"
  | "interrupted"
  | "input"
  | "working"
  | "waiting"
  | "opening"
  | "done"
  | "draft"
  | "idle";

export type SessionRowStatusInput = {
  issue?: "retrying" | "failed";
  interrupted?: boolean;
  needsApproval: boolean;
  busy: boolean;
  wait?: SessionWait | null;
  opening: boolean;
  done: boolean;
  draft: boolean;
};

/**
 * One status per row: failed/retrying > interrupted > needs input > working (busy, no
 * wait) > waiting > opening > done > draft > idle.
 */
export function sessionRowStatusKind(input: SessionRowStatusInput): SessionRowStatusKind {
  if (input.issue) return input.issue;
  if (input.interrupted && !input.busy && !input.needsApproval && !input.opening)
    return "interrupted";
  if (input.needsApproval) return "input";
  if (input.busy && !input.wait) return "working";
  if (input.wait) return "waiting";
  if (input.opening) return "opening";
  if (input.done) return "done";
  if (input.draft) return "draft";
  return "idle";
}

const TONES: Record<SessionRowStatusKind, BadgeTone> = {
  failed: "danger",
  retrying: "warning",
  interrupted: "warning",
  input: "warning",
  working: "accent",
  waiting: "neutral",
  opening: "neutral",
  done: "success",
  draft: "warning",
  idle: "neutral",
};

/** The status mark at the end of a session row; the idle row shows only its time. */
export function SessionRowStatus({
  kind,
  startedAt,
  wait,
  needsInputLabel,
  time,
}: {
  kind: SessionRowStatusKind;
  startedAt?: number;
  wait?: SessionWait | null;
  /** Already translated: the label depends on the input kind and orchestration. */
  needsInputLabel: string;
  /** Relative last-activity time, supplied by the shell. */
  time: ReactNode;
}) {
  const t = useT();
  if (kind === "idle") {
    return (
      <Text size="micro" tone="secondary" className="shrink-0 tabular-nums">
        {time}
      </Text>
    );
  }
  if (kind === "working" || kind === "waiting") {
    return (
      <Badge
        size="sm"
        tone={TONES[kind]}
        appearance="subtle"
        data-session-working-badge
        data-session-waiting-badge={kind === "waiting" ? "" : undefined}
        className="shrink-0 whitespace-nowrap tabular-nums"
      >
        <SessionWorkingStatus startedAt={startedAt} wait={wait ?? undefined} labelled />
      </Badge>
    );
  }
  const alert = <CircleAlert className="icon-xs" strokeWidth={1.75} />;
  return (
    <Badge
      size="sm"
      tone={TONES[kind]}
      appearance="subtle"
      className="shrink-0 whitespace-nowrap tabular-nums"
    >
      {kind === "failed" || kind === "retrying" ? (
        <>
          {alert}
          <span
            {...actionContentAttributes(
              { phase: "rest", hide: "screen-reader" },
              "session-row-status-label",
            )}
          >
            {t(kind === "retrying" ? "Retrying" : "Failed")}
          </span>
        </>
      ) : kind === "interrupted" ? (
        <>
          {alert}
          <span
            {...actionContentAttributes(
              { phase: "rest", hide: "screen-reader" },
              "session-row-status-label",
            )}
          >
            {t("Interrupted")}
          </span>
        </>
      ) : kind === "input" ? (
        <>
          {alert}
          <span
            {...actionContentAttributes(
              { phase: "rest", hide: "screen-reader" },
              "session-row-status-label",
            )}
          >
            {needsInputLabel}
          </span>
        </>
      ) : kind === "opening" ? (
        <>
          <Spinner size="xs" className="shrink-0" />
          <span
            {...actionContentAttributes(
              { phase: "rest", hide: "screen-reader" },
              "session-row-status-label",
            )}
          >
            {t("Opening…")}
          </span>
        </>
      ) : kind === "done" ? (
        <>
          <Check className="icon-xs" strokeWidth={2} />
          <span
            {...actionContentAttributes(
              { phase: "rest", hide: "screen-reader" },
              "session-row-status-label",
            )}
          >
            {t("Done")}
          </span>
        </>
      ) : (
        <>
          <PenLine className="icon-xs" strokeWidth={1.75} />
          <span
            {...actionContentAttributes(
              { phase: "rest", hide: "screen-reader" },
              "session-row-status-label",
            )}
          >
            {t("Draft")}
          </span>
        </>
      )}
    </Badge>
  );
}
