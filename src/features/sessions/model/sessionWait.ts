import { t } from "../../../shared/i18n";
import { sessionNeedsInput, type Session } from "./session";
import { delegationParentOf } from "./delegatedAgents";
import {
  backgroundWait,
  delegatedWait,
  wakeSourceWait,
  type SessionWait,
  type SessionWakeSource,
} from "./sessionWaitRules";

export type { SessionWait, SessionWaitKind, SessionWakeSource } from "./sessionWaitRules";

/** What the session's Host lists for it: its own wait and pending wake sources. */
export type SessionHostWait = {
  waiting?: SessionWait;
  wakeSources?: readonly SessionWakeSource[];
};

/**
 * The "Waiting" row status: the agent yielded, but work it started still runs or
 * something the Host holds will wake it. Null while the agent itself works, needs
 * the user, or has nothing pending. Needs-input and failures outrank waiting at
 * every caller.
 */
export function sessionWait(
  session: Session,
  children: readonly Session[] = [],
  host?: SessionHostWait,
  now = Date.now(),
): SessionWait | null {
  if (session.worktreeRemoved || sessionNeedsInput(session)) return null;
  if (session.busy) return backgroundWait(session);
  // A Host-owned turn: only the Host knows whether it is held open by background work.
  if (session.continuingElsewhere) return host?.waiting ?? null;
  return (
    delegatedWait(
      children.map((child) => ({
        running: !!(child.busy || child.continuingElsewhere),
        startedAt: delegationParentOf(child)?.startedAt,
      })),
    ) ??
    host?.waiting ??
    wakeSourceWait(host?.wakeSources, now)
  );
}

/** One line for tooltips and screen readers: what the wait is on. */
export function sessionWaitReason(wait: SessionWait): string {
  const p0 = String(wait.count);
  switch (wait.kind) {
    case "commands":
      return t("Waiting on background commands: {p0}", { p0 });
    case "agents":
      return t("Waiting on subagents: {p0}", { p0 });
    case "tasks":
      return t("Waiting on background work: {p0}", { p0 });
    case "delegated":
      return t("Waiting on delegated tasks: {p0}", { p0 });
    case "pull-request":
      return t("Waiting on pull request: {p0}", { p0: wait.label || p0 });
  }
}

export function sessionWaitsEqual(a: SessionWait | null, b: SessionWait | null): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.kind === b.kind &&
      a.count === b.count &&
      a.since === b.since &&
      a.label === b.label)
  );
}
