import { Text } from "../../../../shared/ui/Text";
import type { ReactNode } from "react";
import { t } from "../../../../shared/i18n";
import { ActionHost, InlineTextAction } from "../../../../shared/ui/ActionHost";
import {
  Check,
  MessageMultiple,
  MessageSquare,
  Share,
  UserRound,
  Zap,
} from "../../../../shared/ui/icons";
import { StatusText, type StatusTextStatus } from "./StatusText";
import "./activity-row.css";

/** What kind of operation a row describes; picks the glyph inside the status circle. */
export type ActivityKind = "reply" | "publish" | "message" | "audience" | "other";

export type ActivityRowProps = {
  title: string;
  /** Already formatted time, for example from the shared Timestamp helpers. */
  time: string;
  status: StatusTextStatus;
  /** Operation kind for the leading icon; omit for the neutral glyph. */
  kind?: ActivityKind;
  /** Caption content before the time, for example a platform glyph and account name. */
  meta?: ReactNode;
  /** Plain-language detail, always shown under the row (errors included). Technical ids go in TechnicalDetails. */
  details?: ReactNode;
  /**
   * Omit when the entry cannot be undone: no Undo button is rendered, so the reason belongs in
   * `details`. With `blockedReason`, Undo stays visible but disabled, and the tooltip says why.
   */
  undo?: {
    onUndo: () => void;
    blockedReason?: string;
  };
};

type StatusTone = "accent" | "info" | "success" | "warning" | "danger" | "neutral";

function statusTone(status: StatusTextStatus): StatusTone {
  switch (status) {
    case "succeeded":
      return "success";
    case "failed":
      return "danger";
    case "review":
    case "delivery":
    case "needs_human":
      return "warning";
    case "queued":
      return "info";
    case "running":
      return "accent";
    case "cancelled":
      return "neutral";
  }
}

function KindIcon({ kind, neutral }: { kind?: ActivityKind; neutral: boolean }) {
  const props = {
    className: "icon-sm",
    tone: neutral ? "secondary" : "inherit",
    strokeWidth: 1.75,
    "aria-hidden": true,
  } as const;
  switch (kind) {
    case "reply":
      return <MessageSquare {...props} />;
    case "publish":
      return <Share {...props} />;
    case "message":
      return <MessageMultiple {...props} />;
    case "audience":
      return <UserRound {...props} />;
    case "other":
      return <Zap {...props} />;
    default:
      return <Check {...props} />;
  }
}

/** One activity entry: what happened, its status, its detail and Undo. */
export function ActivityRow({ title, time, status, kind, meta, details, undo }: ActivityRowProps) {
  return (
    <div className="social-activity-row">
      <ActionHost className="social-activity-head">
        <span className="social-activity-icon" data-tone={statusTone(status)} aria-hidden="true">
          <KindIcon kind={kind} neutral={statusTone(status) === "neutral"} />
        </span>
        <div className="social-activity-main">
          <Text size="body" tone="primary" leading="inherit" className="social-activity-title">
            {title}
          </Text>
          <Text size="caption" tone="muted" leading="inherit" className="social-activity-meta">
            {meta}
            <span className="social-activity-time">{time}</span>
          </Text>
        </div>
        <StatusText status={status} />
        <div className="social-activity-actions">
          {undo ? (
            <InlineTextAction
              disabled={!!undo.blockedReason}
              disabledReason={undo.blockedReason}
              onClick={undo.onUndo}
            >
              {t("Undo")}
            </InlineTextAction>
          ) : null}
        </div>
      </ActionHost>
      {details ? (
        <Text
          as="div"
          size="caption"
          tone="secondary"
          leading="inherit"
          className="social-activity-details"
        >
          {details}
        </Text>
      ) : null}
    </div>
  );
}
