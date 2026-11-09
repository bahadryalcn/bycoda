import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import {
  hasOwnerApprovalChat,
  ownerApprovalsSnapshot,
  registerOwnerApprovalChat,
  settleOwnerApproval,
  subscribeOwnerApprovals,
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
  return (
    <>
      {children}
      {visible &&
        sessionId &&
        requests
          .filter((request) => request.sessionId === sessionId)
          .map((request) => (
            <section
              key={request.id}
              aria-label={request.title}
              className="shrink-0 border-t border-(--ui-pane-border) px-4 py-3"
            >
              <strong className="text-ui-body">{request.title}</strong>
              <pre className="my-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-ui-caption text-(--ui-text-secondary)">
                {request.message}
              </pre>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => settleOwnerApproval(request.id, false)}>
                  {t(request.cancelLabel)}
                </Button>
                <Button onClick={() => settleOwnerApproval(request.id, true)}>
                  {t(request.confirmLabel)}
                </Button>
              </div>
            </section>
          ))}
      {visible &&
        sessionId &&
        secrets
          .filter((request) => request.sessionId === sessionId)
          .map((request) => (
            <section
              key={request.id}
              aria-label={t("Secret request")}
              className="shrink-0 border-t border-(--ui-pane-border) px-4 py-3"
            >
              <strong className="text-ui-body">{t("Secret request")}</strong>
              <pre className="my-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-ui-caption text-(--ui-text-secondary)">
                {request.message}
              </pre>
              <OwnerSecretForm request={request} />
            </section>
          ))}
    </>
  );
}

/** Off-screen conversations and non-conversation consent use the existing shared dialog. */
export function OwnerApprovalInbox() {
  const t = useT();
  const requests = useSyncExternalStore(subscribeOwnerApprovals, ownerApprovalsSnapshot);
  const secrets = useSyncExternalStore(subscribeOwnerSecretInputs, ownerSecretInputsSnapshot);
  const secret = secrets.find((request) => !hasOwnerApprovalChat(request.sessionId));
  if (secret) return <OwnerSecretDialog key={secret.id} request={secret} />;
  const request = requests.find((request) => !hasOwnerApprovalChat(request.sessionId));
  return request ? (
    <ConfirmDialog
      key={request.id}
      request={{
        title: request.title,
        message: <span className="whitespace-pre-wrap break-words">{request.message}</span>,
        confirmLabel: t(request.confirmLabel),
        cancelLabel: t(request.cancelLabel),
        danger: false,
      }}
      onSettle={(approved) => settleOwnerApproval(request.id, approved)}
    />
  ) : null;
}
