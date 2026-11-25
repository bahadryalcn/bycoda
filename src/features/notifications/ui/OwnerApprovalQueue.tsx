import { useState, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ChevronLeft, ChevronRight } from "../../../shared/ui/icons";
import { Text } from "../../../shared/ui/Text";
import {
  ownerApprovalDraft,
  settleOwnerApproval,
  stageOwnerApproval,
  type OwnerApproval,
} from "../model/ownerApprovals";

export type ApprovalQueue = ReturnType<typeof useApprovalQueue>;

/**
 * Several pending approvals answered as one batch: the owner steps through them, stages Approve or
 * Deny for each and sends every decision together. Nothing settles before Send or Cancel.
 */
export function useApprovalQueue(requests: readonly OwnerApproval[]) {
  const [currentId, setCurrentId] = useState<string>();
  const [decisions, setDecisions] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      requests.flatMap((request) => {
        const draft = ownerApprovalDraft(request.id);
        return draft === undefined ? [] : [[request.id, draft]];
      }),
    ),
  );
  const found = requests.findIndex((request) => request.id === currentId);
  // An answered or expired current request falls back to the first one still open.
  const index =
    found >= 0
      ? found
      : Math.max(
          0,
          requests.findIndex((request) => decisions[request.id] === undefined),
        );
  const request = requests[index]!;
  const decided = requests.filter((item) => decisions[item.id] !== undefined).length;
  const approved = requests.filter((item) => decisions[item.id] === true).length;
  const go = (step: -1 | 1) => setCurrentId(requests[index + step]?.id ?? request.id);
  const choose = (answer: boolean) => {
    stageOwnerApproval(request.id, answer);
    const next = { ...decisions, [request.id]: answer };
    setDecisions(next);
    // Move on to the next open request, wrapping once; stay when every request has a choice.
    const open = [...requests.slice(index + 1), ...requests.slice(0, index)].find(
      (item) => next[item.id] === undefined,
    );
    if (open) setCurrentId(open.id);
  };
  return {
    request,
    index,
    total: requests.length,
    decision: decisions[request.id],
    complete: decided === requests.length,
    approved,
    denied: decided - approved,
    requests,
    decisions,
    go,
    choose,
  };
}

/** Settles every request with its staged choice; Send stays disabled until each has one. */
function sendApprovalQueue(queue: ApprovalQueue) {
  for (const item of queue.requests) {
    const answer = queue.decisions[item.id];
    if (answer !== undefined) settleOwnerApproval(item.id, answer);
  }
}

/** Cancelling a batch denies every request in it. */
function cancelApprovalQueue(requests: readonly OwnerApproval[]) {
  for (const item of requests) settleOwnerApproval(item.id, false);
}

/** Position, previous/next and the staged Deny/Approve choice for the shown request. */
export function ApprovalQueueStep({ queue }: { queue: ApprovalQueue }) {
  const t = useT();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        label={t("Previous request")}
        disabled={queue.index === 0}
        onClick={() => queue.go(-1)}
      >
        <ChevronLeft className="icon-sm" />
      </Button>
      <Text as="span" size="secondary" tone="muted" className="tabular-nums">
        {t("{p0} of {p1}", { p0: queue.index + 1, p1: queue.total })}
      </Text>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        label={t("Next request")}
        disabled={queue.index === queue.total - 1}
        onClick={() => queue.go(1)}
      >
        <ChevronRight className="icon-sm" />
      </Button>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          motion="none"
          pressed={queue.decision === false}
          tone={queue.decision === false ? "danger" : undefined}
          onClick={() => queue.choose(false)}
        >
          {t("Deny")}
        </Button>
        <Button
          size="sm"
          motion="none"
          pressed={queue.decision === true}
          tone={queue.decision === true ? "success" : undefined}
          onClick={() => queue.choose(true)}
        >
          {t("Approve")}
        </Button>
      </div>
    </div>
  );
}

/**
 * The tally, the caller's secondary actions and Send, which waits until every request has a choice.
 * `cancel` adds Cancel, which denies every request; dialogs offer Later instead.
 */
export function ApprovalQueueActions({
  queue,
  cancel = false,
  children,
}: {
  queue: ApprovalQueue;
  cancel?: boolean;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <>
      <Text as="span" size="secondary" tone="muted" className="tabular-nums">
        {t("{p0} approved, {p1} denied", { p0: queue.approved, p1: queue.denied })}
      </Text>
      {cancel ? (
        <Button
          variant="ghost"
          size="sm"
          type="button"
          motion="none"
          onClick={() => cancelApprovalQueue(queue.requests)}
        >
          {t("Cancel")}
        </Button>
      ) : null}
      {children}
      <Button
        variant="primary"
        size="sm"
        type="button"
        motion="none"
        disabled={!queue.complete}
        tooltip={queue.complete ? undefined : t("Choose Approve or Deny for every request first.")}
        onClick={() => sendApprovalQueue(queue)}
      >
        {t("Send")}
      </Button>
    </>
  );
}
