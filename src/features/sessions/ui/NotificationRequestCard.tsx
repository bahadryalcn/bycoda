import { ActionHost } from "../../../shared/ui/ActionHost";
import { Alert } from "../../../shared/ui/Alert";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { X } from "../../../shared/ui/icons";
import { useT } from "../../../shared/i18n";
import { HARNESS_TITLE, sessionDisplayTitle } from "../model/session";
import type { ApprovalDispatch } from "./ApprovalDecisionContext";
import type { Notice } from "./ApprovalToasts";
import { HarnessIcon } from "./HarnessIcon";
import { NotificationProjectLabel, NotificationTime } from "./NotificationHistoryItem";
import { useApprovalDecisionControl } from "./useApprovalDecisionControl";

/**
 * One pending question or approval, as a floating popup or a Pending row of the
 * request center. The body opens the conversation; an approval is decided in
 * place, a question is answered in its conversation.
 */
export function NotificationRequestCard({
  notice,
  occurredAt,
  onFocusSession,
  onApproval,
  onDismiss,
}: {
  notice: Notice;
  /** Shown in the sheet's Pending list; floating popups omit it. */
  occurredAt?: number;
  onFocusSession: (sessionId: string) => void;
  onApproval: ApprovalDispatch;
  onDismiss?: () => void;
}) {
  const t = useT();
  const { session, label, requestId } = notice;
  const title = sessionDisplayTitle(session.title, session.harness);
  const decision = useApprovalDecisionControl(session, requestId, onApproval);
  return (
    <ActionHost
      as="article"
      className="approval-toast notification-request pointer-events-auto flex-col items-stretch gap-0 overflow-clip rounded-(--ui-radius-popup) border border-(--ui-pane-border) bg-(--ui-surface-floating) shadow-(--ui-elevation-floating)"
      role="status"
    >
      <Button
        fullWidth
        variant="item"
        layout="stacked"
        type="button"
        onClick={() => onFocusSession(session.id)}
        className="notification-request-body"
        tooltip={title}
        tooltipWhen="overflow"
      >
        <span
          className={`notification-request-title text-ui-secondary font-medium leading-snug text-(--ui-tone-neutral-fg) ${onDismiss ? "pe-7" : ""}`}
        >
          {title}
        </span>
        <span className="notification-request-preview text-ui-caption leading-relaxed text-(--ui-text-secondary)">
          {label}
        </span>
        <span className="sr-only">{t("Open session")}</span>
      </Button>
      {onDismiss ? (
        <Button
          iconOnly
          label={t("Dismiss notice")}
          variant="ghost"
          type="button"
          onClick={onDismiss}
          tooltip={t("Dismiss notice")}
          aria-label={t("Dismiss notice")}
          className="notification-popup-dismiss"
          data-no-drag=""
        >
          <X className="icon-sm" />
        </Button>
      ) : null}
      {/* One footer row: source, harness and time on the left, kind and the
          decision or the way to answer on the right. */}
      <div className="notification-request-meta notification-request-footer px-3 pb-2">
        <span className="notification-request-source flex min-w-0 items-center gap-2">
          <NotificationProjectLabel cwd={session.cwd} />
          <span className="flex min-w-0 shrink-0 items-center gap-1.5">
            <HarnessIcon harness={session.harness} className="size-3.5 shrink-0" />
            <span className="truncate">{HARNESS_TITLE[session.harness]}</span>
          </span>
          {occurredAt != null ? <NotificationTime at={occurredAt} /> : null}
        </span>
        <span
          className="notification-request-actions flex shrink-0 items-center gap-1"
          data-no-drag=""
        >
          <Badge tone="warning">{notice.kind === "question" ? t("Question") : t("Approval")}</Badge>
          {notice.kind === "approval" ? (
            <>
              <Button
                variant="primary"
                size="sm"
                type="button"
                loading={decision.pending && decision.decision === "allow"}
                disabled={decision.blocked}
                onClick={() => void decision.decide("allow")}
              >
                {t("Allow")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                tone="danger"
                type="button"
                loading={decision.pending && decision.decision === "deny"}
                disabled={decision.blocked}
                onClick={() => void decision.decide("deny")}
              >
                {t("Deny")}
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => onFocusSession(session.id)}
            >
              {t("Answer")}
            </Button>
          )}
        </span>
      </div>
      {notice.kind === "approval" && decision.feedback ? (
        decision.danger ? (
          <Alert tone="danger" inline className="px-3 pb-2">
            {decision.feedback}
          </Alert>
        ) : (
          <div role="status" className="px-3 pb-2 text-ui-caption text-(--ui-text-secondary)">
            {decision.feedback}
          </div>
        )
      ) : null}
    </ActionHost>
  );
}
