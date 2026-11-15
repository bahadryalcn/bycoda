import { Surface } from "../../../shared/ui/Surface";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Text } from "../../../shared/ui/Text";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { ApprovalRequest } from "../../../shared/ui/ApprovalRequest";
import { Modal } from "../../../shared/ui/Modal";
import { InboxApprovalPreview } from "./InboxApprovalPreview";
import {
  hasOwnerApprovalChat,
  ownerApprovalsSnapshot,
  registerOwnerApprovalChat,
  settleOwnerApproval,
  subscribeOwnerApprovals,
  type OwnerApproval,
} from "../model/ownerApprovals";
import { ownerSecretInputsSnapshot, subscribeOwnerSecretInputs } from "../model/ownerSecretInputs";
import { OwnerSecretDialog, OwnerSecretForm } from "./OwnerSecretInput";

/** Native decisions stay transient; they are never copied into provider transcripts. */
export function OwnerApprovalChat({
  sessionId,
  visible = true,
  children,
}: {
  sessionId?: string;
  visible?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const requests = useSyncExternalStore(
    subscribeOwnerApprovals,
    ownerApprovalsSnapshot,
    ownerApprovalsSnapshot,
  );
  const secrets = useSyncExternalStore(
    subscribeOwnerSecretInputs,
    ownerSecretInputsSnapshot,
    ownerSecretInputsSnapshot,
  );
  useEffect(
    () => (visible && sessionId ? registerOwnerApprovalChat(sessionId) : undefined),
    [sessionId, visible],
  );
  const [reviewing, setReviewing] = useState<string | null>(null);
  return (
    <>
      {children}
      {visible &&
        sessionId &&
        requests
          .filter((request) => request.sessionId === sessionId)
          .map((request) => (
            <Surface
              as="div"
              key={request.id}
              variant="canvas"
              frame="pane"
              edge="top"
              padding="md"
              className="shrink-0"
            >
              <ApprovalRequest
                title={request.title}
                detail={request.message}
                allow={{
                  label: t(request.confirmLabel),
                  onClick: () => settleOwnerApproval(request.id, true),
                }}
                deny={{
                  label: t(request.cancelLabel),
                  onClick: () => settleOwnerApproval(request.id, false),
                }}
                actions={
                  request.inbox
                    ? [{ label: t("Review"), onClick: () => setReviewing(request.id) }]
                    : undefined
                }
                details={
                  request.inbox
                    ? {
                        label: t("Details"),
                        content: (
                          <InboxApprovalPreview details={request.inbox} message={request.message} />
                        ),
                      }
                    : undefined
                }
              />
              {reviewing === request.id ? (
                <InboxApprovalDialog request={request} onClose={() => setReviewing(null)} />
              ) : null}
            </Surface>
          ))}
      {visible &&
        sessionId &&
        secrets
          .filter((request) => request.sessionId === sessionId)
          .map((request) => (
            <Surface
              as="section"
              key={request.id}
              aria-label={t("Secret request")}
              variant="canvas"
              frame="pane"
              edge="top"
              padding="md"
              className="shrink-0"
            >
              <Text as="strong" size="body" tone="inherit">
                {t("Secret request")}
              </Text>
              <OutputBlock
                size="caption"
                tone="secondary"
                className="my-2 max-h-48 overflow-auto break-words"
              >
                {request.message}
              </OutputBlock>
              <OwnerSecretForm request={request} />
            </Surface>
          ))}
    </>
  );
}

/** Off-screen conversations and non-conversation consent use the existing shared dialog. */
export function OwnerApprovalInbox() {
  const requests = useSyncExternalStore(subscribeOwnerApprovals, ownerApprovalsSnapshot);
  const secrets = useSyncExternalStore(subscribeOwnerSecretInputs, ownerSecretInputsSnapshot);
  const secret = secrets.find((request) => !hasOwnerApprovalChat(request.sessionId));
  if (secret) return <OwnerSecretDialog key={secret.id} request={secret} />;
  const request = requests.find((request) => !hasOwnerApprovalChat(request.sessionId));
  return request ? (
    <InboxApprovalDialog
      key={request.id}
      request={request}
      onClose={() => settleOwnerApproval(request.id, false)}
    />
  ) : null;
}

/** Full-size Inbox approval; closing it from the chat only returns to the inline request. */
function InboxApprovalDialog({
  request,
  onClose,
}: {
  request: OwnerApproval;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Modal size={request.inbox ? "lg" : "sm"} fitViewport title={request.title} onClose={onClose}>
      <ApprovalRequest
        title={request.title}
        detail={request.message}
        allow={{
          label: t(request.confirmLabel),
          onClick: () => settleOwnerApproval(request.id, true),
        }}
        deny={{
          label: t(request.cancelLabel),
          onClick: () => settleOwnerApproval(request.id, false),
        }}
        details={
          request.inbox
            ? {
                label: t("Details"),
                defaultOpen: true,
                content: <InboxApprovalPreview details={request.inbox} message={request.message} />,
              }
            : undefined
        }
      />
    </Modal>
  );
}
