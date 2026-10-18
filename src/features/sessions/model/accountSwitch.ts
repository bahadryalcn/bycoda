import type { ProviderAccountProvider } from "../../providers/model/providerAccounts";
import { sessionProviderAccountId } from "../../providers/model/providerAccounts";
import {
  isPreparingHandoff,
  pendingHandoff,
  withAccountHandoff,
  withTransferredAccount,
} from "./handoff";
import { sessionWorkCwd, type Block, type Session } from "./session";

export const SWITCH_BUSY_STATUS = "Wait for the current turn to finish before switching accounts.";

export type AccountSwitchDeps = {
  /** Copies the provider thread between accounts; false when it was not found. */
  transfer(input: {
    provider: ProviderAccountProvider;
    fromAccountId: string;
    toAccountId: string;
    providerSessionId: string;
    cwd: string;
  }): Promise<boolean>;
  /** Stops the live child and drops the adapter's resume binding. */
  forget(provider: ProviderAccountProvider, sessionId: string): Promise<void>;
  bind(
    provider: ProviderAccountProvider,
    sessionId: string,
    providerSessionId: string,
    cwd: string,
    accountId: string,
    blocks: Block[],
  ): void;
  /** The session as it is now (it may have changed while a transfer ran). */
  latest(sessionId: string): Session | undefined;
  label(provider: ProviderAccountProvider, accountId: string): string;
  /** The session is being closed. */
  removing?(sessionId: string): boolean;
  /** A newer account-selection request superseded this asynchronous switch. */
  ownsRequest?(): boolean;
};

export type AccountSwitchResult =
  | { kind: "noop" }
  | { kind: "refused"; status: string }
  /** The session changed during the transfer; nothing was applied. */
  | { kind: "stale" }
  | {
      kind: "switched";
      /** How the conversation travels: resumed thread, recap, or nothing to carry. */
      mode: "account" | "transferred" | "handoff";
      update: (session: Session) => Session;
      status?: string;
    };

/** Move one session to another account of its provider, keeping the conversation. */
export async function switchSessionAccount(
  sessionId: string,
  provider: ProviderAccountProvider,
  accountId: string,
  deps: AccountSwitchDeps,
): Promise<AccountSwitchResult> {
  const target = deps.latest(sessionId);
  if (!target || target.harness !== provider) return { kind: "noop" };
  const fromId = sessionProviderAccountId(provider, target);
  if (fromId === accountId) return { kind: "noop" };
  if (target.busy || isPreparingHandoff(target) || deps.removing?.(sessionId)) {
    return { kind: "refused", status: SWITCH_BUSY_STATUS };
  }
  const workCwd = sessionWorkCwd(target);
  const { providerSessionId, cwd, worktreeRemoved, pendingSwitch, blocks } = target;
  const ownsSnapshot = (session: Session | undefined): session is Session =>
    !!session &&
    session.id === target.id &&
    !session.busy &&
    !isPreparingHandoff(session) &&
    !deps.removing?.(sessionId) &&
    deps.ownsRequest?.() !== false &&
    session.harness === provider &&
    session.providerSessionId === providerSessionId &&
    sessionProviderAccountId(provider, session) === fromId &&
    sessionWorkCwd(session) === workCwd &&
    session.cwd === cwd &&
    session.worktreeRemoved === worktreeRemoved &&
    session.pendingSwitch === pendingSwitch &&
    session.blocks === blocks;

  // Nothing of this provider to carry: no turn yet, a harness switch that has
  // not been sent (its recap already travels with that send), or a recap that
  // is already waiting. Only the account changes.
  if (
    !target.blocks.some((block) => block.role === "user") ||
    target.pendingSwitch ||
    (!target.providerSessionId && pendingHandoff(target))
  ) {
    await deps.forget(provider, sessionId);
    if (!ownsSnapshot(deps.latest(sessionId))) return { kind: "stale" };
    return {
      kind: "switched",
      mode: "account",
      update: (s) => (ownsSnapshot(s) ? { ...s, providerAccountId: accountId } : s),
    };
  }

  let transferred = false;
  if (target.providerSessionId) {
    try {
      transferred = await deps.transfer({
        provider,
        fromAccountId: fromId,
        toAccountId: accountId,
        providerSessionId: target.providerSessionId,
        cwd: workCwd,
      });
    } catch {
      transferred = false;
    }
  }
  // The transfer is async; the session may have moved on meanwhile.
  const latest = deps.latest(sessionId);
  if (!ownsSnapshot(latest)) {
    return { kind: "stale" };
  }

  // The live child holds the old account's environment: stop it so the next
  // send spawns under the new one, then rebind the thread to that account.
  await deps.forget(provider, sessionId);
  const afterForget = deps.latest(sessionId);
  if (!ownsSnapshot(afterForget)) return { kind: "stale" };
  if (transferred && afterForget.providerSessionId) {
    deps.bind(
      provider,
      sessionId,
      afterForget.providerSessionId,
      workCwd,
      accountId,
      afterForget.blocks,
    );
  }
  const label = deps.label(provider, accountId);
  return {
    kind: "switched",
    mode: transferred ? "transferred" : "handoff",
    update: (s) =>
      !ownsSnapshot(s)
        ? s
        : transferred
          ? withTransferredAccount(s, accountId)
          : withAccountHandoff(s, accountId),
    status: transferred
      ? `Continuing with ${label}`
      : `Continuing with ${label}. The conversation could not be moved over, so a summary goes with your next message.`,
  };
}
