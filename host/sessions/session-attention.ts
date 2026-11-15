import type { HostSession } from "../../src/features/connections/model/protocol";
import { sessionNeedsInput } from "../../src/features/sessions/model/session";

export interface SessionAttentionPatch {
  unread?: boolean;
  snoozedUntil?: number | null;
  expectedRevision?: number;
}

export function sessionAttentionUpdate(current: HostSession, patch: SessionAttentionPatch) {
  if (patch.expectedRevision !== undefined && patch.expectedRevision !== current.revision)
    throw new Error("This session changed. Refresh the list and review it again.");
  if (patch.unread !== undefined && typeof patch.unread !== "boolean")
    throw new Error("Invalid unread value");
  if (
    patch.snoozedUntil !== undefined &&
    patch.snoozedUntil !== null &&
    (!Number.isSafeInteger(patch.snoozedUntil) || !sessionSnoozed(patch))
  )
    throw new Error("Invalid snooze time");
  return {
    ...(patch.unread === undefined
      ? {}
      : {
          forceUnread: patch.unread,
          ...(patch.unread
            ? {}
            : { lastViewedAt: Date.now(), lastViewedRevision: current.revision }),
        }),
    ...(patch.snoozedUntil === undefined ? {} : { snoozedUntil: patch.snoozedUntil }),
  };
}

export function sessionAttentionSummary(value: HostSession) {
  return {
    unread: sessionUnread(value),
    lastViewedAt: value.lastViewedAt ?? 0,
    lastViewedRevision: value.lastViewedRevision ?? value.revision,
    agentActivityRevision: value.agentActivityRevision ?? 0,
    forceUnread: value.forceUnread ?? false,
    snoozedUntil: value.snoozedUntil ?? null,
  };
}

/** Revision counters explain unread, but never churn a list whose visible state is unchanged. */
export function sessionAttentionListFields<
  T extends Pick<
    HostSession,
    "lastViewedAt" | "lastViewedRevision" | "agentActivityRevision" | "forceUnread"
  >,
>(value: T) {
  const {
    lastViewedAt: _a,
    lastViewedRevision: _v,
    agentActivityRevision: _r,
    forceUnread: _f,
    ...visible
  } = value;
  return visible;
}

/** Host-owned metadata. Legacy snapshots start read; subsequent agent activity advances the revision. */
export function sessionUnread(value: HostSession): boolean {
  return (
    value.forceUnread === true ||
    (value.agentActivityRevision ?? 0) > (value.lastViewedRevision ?? value.revision)
  );
}

export function sessionAttention(
  input: HostSession,
  previous?: HostSession,
  metadataWrite = false,
) {
  const oldBlocks = new Map(previous?.session.blocks.map((block) => [block.id, block]) ?? []);
  const needsInput = sessionNeedsInput(input.session);
  const newNeedsInput =
    needsInput &&
    (!previous ||
      !sessionNeedsInput(previous.session) ||
      input.session.pendingQuestion?.requestId !== previous.session.pendingQuestion?.requestId ||
      input.session.pendingQuestion?.occurrenceId !==
        previous.session.pendingQuestion?.occurrenceId ||
      input.session.blocks.some(
        (block) =>
          block.approval &&
          !block.approval.decided &&
          (!oldBlocks.get(block.id)?.approval ||
            oldBlocks.get(block.id)?.approval?.decided ||
            oldBlocks.get(block.id)?.approval?.occurrenceId !== block.approval.occurrenceId ||
            oldBlocks.get(block.id)?.approval?.requestId !== block.approval.requestId),
      ));
  const activity =
    newNeedsInput ||
    (previous?.status === "running" && input.status !== "running") ||
    input.session.blocks.some((block) => {
      if (block.role !== "assistant") return false;
      const old = oldBlocks.get(block.id);
      return !old || old.text !== block.text;
    });
  const owner = previous && !metadataWrite ? previous : input;
  const fields = {
    lastViewedAt: owner.lastViewedAt ?? 0,
    lastViewedRevision: owner.lastViewedRevision ?? previous?.revision ?? 0,
    forceUnread: owner.forceUnread ?? false,
    agentActivityRevision: activity
      ? input.revision
      : (previous?.agentActivityRevision ?? input.agentActivityRevision ?? 0),
    snoozedUntil: newNeedsInput ? null : (owner.snoozedUntil ?? null),
  };
  return { ...fields, unread: sessionUnread({ ...input, ...fields }) };
}

/** Shared list rule: a deadline expiring requires no write or metadata revision. */
export function sessionSnoozed(value: { snoozedUntil?: number | null }, now = Date.now()) {
  return typeof value.snoozedUntil === "number" && value.snoozedUntil > now;
}
