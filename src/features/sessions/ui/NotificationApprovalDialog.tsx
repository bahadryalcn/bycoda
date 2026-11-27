import { useT } from "../../../shared/i18n";
import { ApprovalActions, ApprovalRequest } from "../../../shared/ui/ApprovalRequest";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { ArrowRight } from "../../../shared/ui/icons";
import { sessionDisplayTitle } from "../model/session";
import type { ApprovalDispatch } from "./ApprovalDecisionContext";
import type { Notice } from "./ApprovalToasts";
import { HarnessIcon } from "./HarnessIcon";
import { NotificationProjectLabel } from "./NotificationHistoryItem";
import { noticeApproval } from "./NotificationRequestCard";
import { approvalHasInspection, ToolInspectionPanel } from "./ToolInspectionPanel";
import { approvalTitle } from "./approvalPresentation";
import { useApprovalDecisionControl } from "./useApprovalDecisionControl";

/**
 * A conversation's pending approval answered from the notification sheet: the project and
 * conversation that asked, the exact request and its details, and Deny/Allow in the footer.
 * Go leaves the dialog for the conversation instead.
 */
export function NotificationApprovalDialog({
  notice,
  onFocusSession,
  onApproval,
  onClose,
}: {
  notice: Notice;
  onFocusSession: (sessionId: string) => void;
  onApproval: ApprovalDispatch;
  onClose: () => void;
}) {
  const t = useT();
  const { session, requestId } = notice;
  const { block, detail } = noticeApproval(notice);
  const decision = useApprovalDecisionControl(session, requestId, onApproval);
  const allow = {
    label: t("Allow"),
    pending: decision.pending && !decision.allowForSessionPending && decision.decision === "allow",
    disabled: decision.blocked,
    onClick: () => void decision.decide("allow"),
  };
  const deny = {
    label: t("Deny"),
    pending: decision.pending && decision.decision === "deny",
    disabled: decision.blocked,
    onClick: () => void decision.decide("deny"),
  };
  const actions = decision.sessionAction ? [decision.sessionAction] : undefined;
  return (
    <Modal
      size="md"
      fitViewport
      title={approvalTitle(block, t)}
      context={
        <span className="flex min-w-0 items-center gap-2">
          <NotificationProjectLabel cwd={session.cwd} />
          <span aria-hidden="true">·</span>
          <HarnessIcon harness={session.harness} className="size-3.5 shrink-0" />
          <Text as="span" size="inherit" tone="inherit" truncate className="min-w-0">
            {sessionDisplayTitle(session.title, session.harness)}
          </Text>
        </span>
      }
      initialFocus="[data-modal-actions] button"
      onClose={onClose}
      footer={
        <ModalActions
          start={
            <Button
              variant="ghost"
              size="sm"
              type="button"
              motion="none"
              startIcon={<ArrowRight className="icon-sm" />}
              onClick={() => {
                onClose();
                onFocusSession(session.id);
              }}
            >
              {t("Go")}
            </Button>
          }
        >
          <ApprovalActions allow={allow} deny={deny} actions={actions} />
        </ModalActions>
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        <ApprovalRequest
          title={approvalTitle(block, t)}
          appearance="compact"
          actionsPlacement="none"
          detail={detail}
          details={
            block && approvalHasInspection(block, detail)
              ? { label: t("Details"), content: <ToolInspectionPanel block={block} /> }
              : undefined
          }
          allow={allow}
          deny={deny}
          actions={actions}
        />
        {decision.feedback ? (
          decision.danger ? (
            <InlineError>{decision.feedback}</InlineError>
          ) : (
            <InlineMessage tone="neutral">{decision.feedback}</InlineMessage>
          )
        ) : null}
      </div>
    </Modal>
  );
}
