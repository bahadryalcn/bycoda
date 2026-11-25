import { ClampText } from "../../../shared/ui/ClampText";
import { Text } from "../../../shared/ui/Text";
import { LiveText } from "../../../shared/ui/LiveText";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { motionAttributes } from "../../../shared/ui/Motion";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { ApprovalRequest } from "../../../shared/ui/ApprovalRequest";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { Button } from "../../../shared/ui/Button";
import { X } from "../../../shared/ui/icons";
import { useT } from "../../../shared/i18n";
import { sessionDisplayTitle } from "../model/session";
import type { ApprovalDispatch } from "./ApprovalDecisionContext";
import type { Notice } from "./ApprovalToasts";
import { HarnessIcon } from "./HarnessIcon";
import { NotificationProjectLabel } from "./NotificationHistoryItem";
import { hasToolInspection, ToolInspectionPanel } from "./ToolInspectionPanel";
import { bycodaToolCall } from "../model/bycodaToolCall";
import { approvalTitle } from "./approvalPresentation";
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
  const block = session.blocks.find(
    (item) => item.approval?.requestId === requestId && !item.approval.decided,
  );
  const detail = block
    ? (bycodaToolCall(block)?.command ??
      (block.tool?.preview?.kind === "shell" ? block.tool.preview.title : undefined) ??
      block.tool?.title ??
      block.text)
    : label;
  const title = sessionDisplayTitle(session.title, session.harness);
  const decision = useApprovalDecisionControl(session, requestId, onApproval);
  return (
    <ActionHost
      as="article"
      variant={onDismiss ? "floating" : "row"}
      {...motionAttributes(
        {
          enter: onDismiss ? "down" : undefined,
          transition: "colors",
          duration: "standard",
        },
        "approval-toast notification-request pointer-events-auto flex-col items-stretch gap-0 overflow-clip",
      )}
    >
      {/* The popup announces itself: the card is not a live region, its own text is. */}
      <LiveText className="sr-only" text={`${title}. ${label}`} />
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
          className={`notification-request-title ${onDismiss ? "pe-[calc(1.5rem+0.25rem)]" : ""}`}
        >
          {title}
        </ClampText>
        <ClampText
          as="span"
          lines={1}
          expandable={false}
          size="caption"
          tone="secondary"
          weight="regular"
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
          className="notification-popup-dismiss"
          data-no-drag=""
        >
          <X className="icon-sm" />
        </Button>
      ) : null}
      {/* Source and time share the footer with the action that opens the conversation. */}
      <Text
        as="div"
        size="caption"
        tone="secondary"
        leading="inherit"
        className="notification-request-meta notification-request-footer px-3 pb-2"
      >
        <span className="notification-request-source flex min-w-0 items-center gap-2">
          <NotificationProjectLabel cwd={session.cwd} />
          <HarnessIcon harness={session.harness} className="size-3.5 shrink-0" />
          {occurredAt != null ? <Timestamp value={occurredAt} format="relative" /> : null}
        </span>
        {notice.kind === "question" ? (
          <Button
            className="ms-auto shrink-0"
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => onFocusSession(session.id)}
          >
            {t("Answer")}
          </Button>
        ) : null}
      </Text>
      {notice.kind === "approval" ? (
        <div className="px-3 pb-2">
          <ApprovalRequest
            title={approvalTitle(block, t)}
            actions={decision.sessionAction ? [decision.sessionAction] : undefined}
            detail={detail}
            details={
              block && hasToolInspection(block)
                ? {
                    label: t("Details"),
                    content: <ToolInspectionPanel block={block} />,
                  }
                : undefined
            }
            allow={{
              label: t("Allow"),
              pending:
                decision.pending &&
                !decision.allowForSessionPending &&
                decision.decision === "allow",
              disabled: decision.blocked,
              onClick: () => void decision.decide("allow"),
            }}
            deny={{
              label: t("Deny"),
              pending: decision.pending && decision.decision === "deny",
              disabled: decision.blocked,
              onClick: () => void decision.decide("deny"),
            }}
          />
        </div>
      ) : null}
      {notice.kind === "approval" && decision.feedback ? (
        decision.danger ? (
          <InlineError inset="row">{decision.feedback}</InlineError>
        ) : (
          <InlineMessage tone="neutral" inset="row">
            {decision.feedback}
          </InlineMessage>
        )
      ) : null}
    </ActionHost>
  );
}
