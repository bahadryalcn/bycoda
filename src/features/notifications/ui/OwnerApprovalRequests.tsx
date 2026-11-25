import { ownerPromptLabel } from "../model/ownerPromptLabels";
import { Surface } from "../../../shared/ui/Surface";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { ApprovalRequest } from "../../../shared/ui/ApprovalRequest";
import { Button } from "../../../shared/ui/Button";
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
import { OwnerSecretDialog, OwnerSecretForm, OwnerSecretHeader } from "./OwnerSecretInput";

/** Filled, accent-framed card in the chat column (same width as messages and composer) so an owner request reads as pending action. */
function OwnerRequestCard({
  as,
  children,
  ...props
}: {
  as: "div" | "section";
  children: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <div data-chat-column className="mx-auto w-full min-w-0 max-w-4xl shrink-0 px-3 pb-2">
      <Surface
        {...props}
        as={as}
        variant="card"
        tone="info"
        frame="accent"
        radius="card"
        padding="md"
      >
        {children}
      </Surface>
    </div>
  );
}

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
  return (
    <>
      {children}
      {visible &&
        sessionId &&
        requests
          .filter((request) => request.sessionId === sessionId)
          .map((request) => (
            <OwnerRequestCard as="div" key={request.id}>
              <ApprovalRequest
                title={request.title}
                detail={request.message}
                allow={{
                  label: ownerPromptLabel(t, request.confirmLabel),
                  onClick: () => settleOwnerApproval(request.id, true),
                }}
                deny={{
                  label: ownerPromptLabel(t, request.cancelLabel),
                  onClick: () => settleOwnerApproval(request.id, false),
                }}
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
            </OwnerRequestCard>
          ))}
      {visible &&
        sessionId &&
        secrets
          .filter((request) => request.sessionId === sessionId)
          .map((request) => (
            <OwnerRequestCard as="section" key={request.id} aria-label={t("Secret request")}>
              <div className="flex min-w-0 flex-col gap-2">
                <OwnerSecretHeader request={request} />
                <OwnerSecretForm request={request} />
              </div>
            </OwnerRequestCard>
          ))}
    </>
  );
}

/**
 * Off-screen conversations and non-conversation consent use the existing shared dialog.
 * Closing it (Escape, backdrop, close button) defers the request: it stays pending behind a
 * reopen button and only the explicit Deny/Cancel action rejects it.
 */
export function OwnerApprovalInbox() {
  const t = useT();
  const requests = useSyncExternalStore(subscribeOwnerApprovals, ownerApprovalsSnapshot);
  const secrets = useSyncExternalStore(subscribeOwnerSecretInputs, ownerSecretInputsSnapshot);
  const [deferred, setDeferred] = useState<ReadonlySet<string>>(new Set());
  const defer = (id: string) => setDeferred((current) => new Set(current).add(id));
  const reopen = (id: string) =>
    setDeferred((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  const waiting = [
    ...secrets.filter((request) => !hasOwnerApprovalChat(request.sessionId)),
    ...requests.filter((request) => !hasOwnerApprovalChat(request.sessionId)),
  ];
  const secret = secrets.find(
    (request) => !hasOwnerApprovalChat(request.sessionId) && !deferred.has(request.id),
  );
  const request = requests.find(
    (request) => !hasOwnerApprovalChat(request.sessionId) && !deferred.has(request.id),
  );
  const parked = waiting.filter((item) => deferred.has(item.id));
  return (
    <>
      {secret ? (
        <OwnerSecretDialog key={secret.id} request={secret} onClose={() => defer(secret.id)} />
      ) : request ? (
        <InboxApprovalDialog key={request.id} request={request} onClose={() => defer(request.id)} />
      ) : null}
      {!secret && !request && parked.length > 0 ? (
        <div className="fixed bottom-3 end-3 z-(--layer-toast)">
          <Button
            variant="secondary"
            size="sm"
            data-owner-request-reopen=""
            onClick={() => reopen(parked[0].id)}
          >
            {t("Review pending request ({p0})", { p0: parked.length })}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** Full-size approval for requests whose conversation is not on screen; closing it defers the request. */
function InboxApprovalDialog({
  request,
  onClose,
}: {
  request: OwnerApproval;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Modal
      size={request.inbox ? "lg" : "sm"}
      fitViewport
      title={request.title}
      minimalHeader
      onClose={onClose}
    >
      <div className="me-(--modal-close-clearance)">
        <ApprovalRequest
          title={request.title}
          detail={request.message}
          allow={{
            label: ownerPromptLabel(t, request.confirmLabel),
            onClick: () => settleOwnerApproval(request.id, true),
          }}
          deny={{
            label: ownerPromptLabel(t, request.cancelLabel),
            onClick: () => settleOwnerApproval(request.id, false),
          }}
          details={
            request.inbox
              ? {
                  label: t("Details"),
                  defaultOpen: true,
                  content: (
                    <InboxApprovalPreview details={request.inbox} message={request.message} />
                  ),
                }
              : undefined
          }
        />
      </div>
    </Modal>
  );
}
