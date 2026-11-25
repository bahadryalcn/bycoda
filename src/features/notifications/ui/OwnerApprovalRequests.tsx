import { Surface } from "../../../shared/ui/Surface";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { ApprovalActions } from "../../../shared/ui/ApprovalRequest";
import type { NoticeAction } from "../../../shared/ui/Notice";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { Button } from "../../../shared/ui/Button";
import { Heading } from "../../../shared/ui/Heading";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { StatusText } from "../../../shared/ui/StatusText";
import {
  ApprovalQueueActions,
  ApprovalQueueStep,
  useApprovalQueue,
  type ApprovalQueue,
} from "./OwnerApprovalQueue";
import { InboxApprovalPreview, InboxApprovalTarget } from "./InboxApprovalPreview";
import { ManagementApprovalPreview, managementApprovalTitle } from "./ManagementApprovalPreview";
import {
  deferOwnerApprovals,
  hasOwnerApprovalChat,
  isOwnerApprovalDeferred,
  ownerApprovalsSnapshot,
  registerOwnerApprovalChat,
  settleOwnerApproval,
  subscribeOwnerApprovals,
  type OwnerApproval,
} from "../model/ownerApprovals";
import { ownerSecretInputsSnapshot, subscribeOwnerSecretInputs } from "../model/ownerSecretInputs";
import { OwnerSecretDialog, OwnerSecretForm, OwnerSecretHeader } from "./OwnerSecretInput";

function approvalTitle(request: OwnerApproval, t: (key: string) => string) {
  if (request.inbox) {
    switch (request.inbox.action) {
      case "comment":
        return t("Comment");
      case "review":
        return t("Review");
      case "pr-action":
        return t("Pull request");
    }
  }
  return request.management
    ? t(managementApprovalTitle(request.management))
    : t(request.title.replace(/^bycoda — /, ""));
}

function SingleApprovalActions({
  request,
  actions,
}: {
  request: OwnerApproval;
  actions?: readonly NoticeAction[];
}) {
  const t = useT();
  return (
    <ApprovalActions
      allow={{
        label: t(request.inbox ? "Approve" : request.confirmLabel),
        onClick: () => settleOwnerApproval(request.id, true),
      }}
      deny={{
        label: t("Deny"),
        onClick: () => settleOwnerApproval(request.id, false),
      }}
      actions={actions}
    />
  );
}

function ApprovalContent({ request }: { request: OwnerApproval }) {
  if (request.inbox)
    return <InboxApprovalPreview details={request.inbox} message={request.message} />;
  if (request.management)
    return <ManagementApprovalPreview details={request.management} message={request.message} />;
  return (
    <OutputBlock frame="filled" tone="primary">
      {request.message}
    </OutputBlock>
  );
}

function ChatApproval({ requests }: { requests: readonly OwnerApproval[] }) {
  const t = useT();
  const queue = useApprovalQueue(requests);
  const [reviewing, setReviewing] = useState(false);
  const request = queue.request;
  const batch = queue.total > 1;
  const title = approvalTitle(request, t);
  const review = { label: t("Review"), onClick: () => setReviewing(true) };
  const details = (
    <Surface
      key={request.id}
      as="section"
      aria-label={t("Details")}
      focusRing="inset"
      tabIndex={0}
      className="max-h-[min(24cqb,12rem)] min-w-0 overflow-y-auto overscroll-y-contain pe-2"
    >
      <ApprovalContent request={request} />
    </Surface>
  );
  return (
    <Surface
      as="section"
      aria-label={title}
      variant="canvas-chat"
      frame="card"
      radius="card"
      padding="md"
      className="flex min-w-0 flex-col gap-2"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <StatusText tone="needs-you">
            {batch ? t("{p0} requests need approval", { p0: queue.total }) : t("Needs approval")}
          </StatusText>
          <Heading as="div" size="item">
            {title}
          </Heading>
          {request.inbox ? <InboxApprovalTarget details={request.inbox} /> : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {batch ? (
            <Button variant="ghost" size="sm" type="button" motion="none" onClick={review.onClick}>
              {review.label}
            </Button>
          ) : (
            <SingleApprovalActions request={request} actions={[review]} />
          )}
        </div>
      </div>
      {request.inbox ? <Disclosure summary={t("Details")}>{details}</Disclosure> : details}
      {batch ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <ApprovalQueueStep queue={queue} />
          <div className="ms-auto flex min-w-0 flex-wrap items-center gap-2">
            <ApprovalQueueActions queue={queue} cancel />
          </div>
        </div>
      ) : null}
      {reviewing ? <OwnerApprovalDialog queue={queue} onClose={() => setReviewing(false)} /> : null}
    </Surface>
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
  // Register only visible chats so requests on other pages open in the shared dialog.
  useEffect(
    () => (visible && sessionId ? registerOwnerApprovalChat(sessionId) : undefined),
    [sessionId, visible],
  );
  const chatRequests =
    visible && sessionId ? requests.filter((r) => r.sessionId === sessionId) : [];
  const chatSecrets = visible && sessionId ? secrets.filter((r) => r.sessionId === sessionId) : [];
  return (
    <>
      {children}
      {chatRequests.length || chatSecrets.length ? (
        <div
          data-chat-column
          className="mx-auto flex max-h-[min(100%,55cqb,22rem)] w-full min-w-0 max-w-4xl shrink-0 flex-col gap-2 overflow-y-auto overscroll-y-contain px-3 pb-2 [&>*]:shrink-0"
        >
          {chatRequests.length ? <ChatApproval requests={chatRequests} /> : null}
          {chatSecrets.map((request) => (
            <Surface
              as="section"
              key={request.id}
              aria-label={t("Secret request")}
              variant="card"
              tone="info"
              frame="accent"
              radius="card"
              elevation="floating"
              padding="md"
            >
              <div className="flex min-w-0 flex-col gap-2">
                <OwnerSecretHeader request={request} />
                <OwnerSecretForm request={request} />
              </div>
            </Surface>
          ))}
        </div>
      ) : null}
    </>
  );
}

/**
 * Off-screen conversations and non-conversation consent use the shared dialog. Later hides the
 * requests without answering them: their conversation keeps waiting and shows the card, and the
 * pending sheet still lists them until they are answered or reach their deadline.
 */
export function OwnerApprovalInbox({
  onOpenSession,
}: {
  onOpenSession?: (sessionId: string) => unknown;
}) {
  const requests = useSyncExternalStore(subscribeOwnerApprovals, ownerApprovalsSnapshot);
  const secrets = useSyncExternalStore(subscribeOwnerSecretInputs, ownerSecretInputsSnapshot);
  const secret = secrets.find((request) => !hasOwnerApprovalChat(request.sessionId));
  if (secret) return <OwnerSecretDialog key={secret.id} request={secret} />;
  const offPage = requests.filter(
    (request) => !hasOwnerApprovalChat(request.sessionId) && !isOwnerApprovalDeferred(request.id),
  );
  return offPage.length ? (
    <OwnerApprovalInboxDialog requests={offPage} onOpenSession={onOpenSession} />
  ) : null;
}

function OwnerApprovalInboxDialog({
  requests,
  onOpenSession,
}: {
  requests: readonly OwnerApproval[];
  onOpenSession?: (sessionId: string) => unknown;
}) {
  const t = useT();
  const queue = useApprovalQueue(requests);
  const sessionId = queue.request.sessionId;
  const ids = queue.requests.map((request) => request.id);
  // Review opens the conversation that asked; its chat card then takes over from this dialog.
  return (
    <OwnerApprovalDialog
      queue={queue}
      actions={[
        { label: t("Later"), onClick: () => deferOwnerApprovals(ids) },
        ...(sessionId && onOpenSession
          ? [{ label: t("Review"), onClick: () => void onOpenSession(sessionId) }]
          : []),
      ]}
      onClose={() => deferOwnerApprovals(ids)}
    />
  );
}

/** Closing a chat review returns to the card. Closing an off-page approval defers it. */
function OwnerApprovalDialog({
  queue,
  actions,
  onClose,
}: {
  queue: ApprovalQueue;
  actions?: readonly NoticeAction[];
  onClose: () => void;
}) {
  const t = useT();
  const request = queue.request;
  const batch = queue.total > 1;
  return (
    <Modal
      size="md"
      fitViewport
      title={approvalTitle(request, t)}
      context={
        <StatusText tone="needs-you">
          {batch ? t("{p0} requests need approval", { p0: queue.total }) : t("Needs approval")}
        </StatusText>
      }
      initialFocus={batch && actions ? "[data-approval-first]" : "[data-modal-actions] button"}
      onClose={onClose}
      footer={
        batch ? (
          <ModalActions start={<ApprovalQueueStep queue={queue} />}>
            <ApprovalQueueActions queue={queue}>
              {actions?.map((action, index) => (
                <Button
                  key={index}
                  variant="ghost"
                  size="sm"
                  type="button"
                  motion="none"
                  data-approval-first={index === 0 ? "" : undefined}
                  onClick={action.onClick}
                >
                  {action.label}
                </Button>
              ))}
            </ApprovalQueueActions>
          </ModalActions>
        ) : (
          <ModalActions>
            <SingleApprovalActions request={request} actions={actions} />
          </ModalActions>
        )
      }
    >
      <div key={request.id} className="flex min-w-0 flex-col gap-3">
        {request.inbox ? <InboxApprovalTarget details={request.inbox} /> : null}
        <ApprovalContent request={request} />
      </div>
    </Modal>
  );
}
