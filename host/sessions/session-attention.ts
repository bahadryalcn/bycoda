import type { HostSession } from "../../src/features/connections/model/protocol";
import { sessionNeedsInput } from "../../src/features/sessions/model/session";

/** Host-owned metadata. Legacy snapshots start read; subsequent agent activity advances the revision. */
export function sessionUnread(value: HostSession): boolean {
  return value.forceUnread === true ||
    (value.agentActivityRevision ?? 0) > (value.lastViewedRevision ?? value.revision);
}

export function sessionAttention(input: HostSession, previous?: HostSession) {
  const oldBlocks = new Map(previous?.session.blocks.map(block => [block.id, block]) ?? []);
  const needsInput = sessionNeedsInput(input.session);
  const newNeedsInput = needsInput && (!previous || !sessionNeedsInput(previous.session));
  const activity = newNeedsInput ||
    (previous?.status === "running" && input.status !== "running") ||
    input.session.blocks.some(block => {
      if (block.role !== "assistant") return false;
      const old = oldBlocks.get(block.id);
      return !old || old.text !== block.text;
    });
  return {
    lastViewedAt: input.lastViewedAt ?? previous?.lastViewedAt ?? 0,
    lastViewedRevision: input.lastViewedRevision ?? previous?.lastViewedRevision ?? previous?.revision ?? 0,
    forceUnread: input.forceUnread ?? previous?.forceUnread ?? false,
    agentActivityRevision: activity ? input.revision : (previous?.agentActivityRevision ?? input.agentActivityRevision ?? 0),
    snoozedUntil: newNeedsInput ? null : (input.snoozedUntil ?? null),
  };
}

/** Shared list rule: a deadline expiring requires no write or metadata revision. */
export function sessionSnoozed(value: { snoozedUntil?: number | null }, now = Date.now()) {
  return typeof value.snoozedUntil === "number" && value.snoozedUntil > now;
}
