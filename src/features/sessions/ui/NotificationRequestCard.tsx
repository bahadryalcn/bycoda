import { ClampText } from "../../../shared/ui/ClampText";
import { Text } from "../../../shared/ui/Text";
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
 * One pending question or approval, as a floating popup or a row of the sheet's
 * pending card. The body opens the conversation; an approval is decided in
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
  /** Shown in the sheet's pending card; floating popups omit it. */
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
      className="approval-toast notification-request pointer-events-auto flex-col items-stretch gap-0 overflow-clip"
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
        <ClampText
          as="span"
          lines={2}
          expandable={false}
          size="secondary"
          tone="neutral"
          weight="medium"
          leading="snug"
          className={`notification-request-title ${onDismiss ? "pe-7" : ""}`}
        >
          {title}
        </ClampText>
        <ClampText
          as="span"
          lines={3}
          expandable={false}
          size="caption"
          tone="secondary"
          leading="relaxed"
          className="notification-request-preview"
        >
          {label}
        </ClampText>
        <span className="sr-only">{t("Open session")}</span>
      </Button>
      {onDismiss ? (
        <Button
          iconOnly
          label={t("Dismiss notice")}
          variant="ghost"
          type="button"
          onClick={onDismiss}
          aria-label={t("Dismiss notice")}
          className="notification-popup-dismiss"
          data-no-drag=""
        >
          <X className="icon-sm" />
        </Button>
      ) : null}
      {/* One footer row: source, harness and time on the left, kind and the
          decision or the way to answer on the right. */}
      <Text
        as="div"
        size="caption"
        tone="secondary"
        leading="inherit"
        className="notification-request-meta notification-request-footer px-3 pb-2"
      >
        <span className="notification-request-source flex min-w-0 items-center gap-2">
          <NotificationProjectLabel cwd={session.cwd} />
          <span className="flex min-w-0 shrink-0 items-center gap-1.5">
            <HarnessIcon harness={session.harness} className="size-3.5 shrink-0" />
            <Text size="inherit" tone="inherit" truncate>
              {HARNESS_TITLE[session.harness]}
            </Text>
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
      </Text>
      {notice.kind === "approval" && decision.feedback ? (
        decision.danger ? (
          <Alert tone="danger" inline className="px-3 pb-2">
            {decision.feedback}
          </Alert>
        ) : (
          <Text role="status" as="div" size="caption" tone="secondary" className="px-3 pb-2">
            {decision.feedback}
          </Text>
        )
      ) : null}
    </ActionHost>
  );
}
