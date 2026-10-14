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

  // Nothing of this provider to carry: no turn yet, a harness switch that has
  // not been sent (its recap already travels with that send), or a recap that
  // is already waiting. Only the account changes.
  if (
    !target.blocks.some((block) => block.role === "user") ||
    target.pendingSwitch ||
    (!target.providerSessionId && pendingHandoff(target))
  ) {
    await deps.forget(provider, sessionId);
    return {
      kind: "switched",
      mode: "account",
      update: (s) => ({ ...s, providerAccountId: accountId }),
    };
  }

  const workCwd = sessionWorkCwd(target);
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
  if (
    !latest ||
    latest.busy ||
    latest.harness !== provider ||
    latest.providerSessionId !== target.providerSessionId ||
    sessionProviderAccountId(provider, latest) !== fromId
  ) {
    return { kind: "stale" };
  }

  // The live child holds the old account's environment: stop it so the next
  // send spawns under the new one, then rebind the thread to that account.
  await deps.forget(provider, sessionId);
  if (transferred && latest.providerSessionId) {
    deps.bind(provider, sessionId, latest.providerSessionId, workCwd, accountId, latest.blocks);
  }
  const label = deps.label(provider, accountId);
  return {
    kind: "switched",
    mode: transferred ? "transferred" : "handoff",
    update: (s) =>
      transferred ? withTransferredAccount(s, accountId) : withAccountHandoff(s, accountId),
    status: transferred
      ? `Continuing with ${label}`
      : `Continuing with ${label}. The conversation could not be moved over, so a summary goes with your next message.`,
  };
}
