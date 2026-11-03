import type { Block, HarnessId, Session } from "./session";

export type SessionProviderHistory = {
  providers: HarnessId[];
  activeHarness: HarnessId;
  activeModel?: string;
  handedOffFrom?: HarnessId;
};

type ProviderHistoryInput = Pick<Session, "harness"> &
  Partial<Pick<Session, "blocks" | "runningModelTarget" | "pendingSwitch">> & {
    providerHistory?: SessionProviderHistory;
  };

/** Submitted turn provenance wins over a composer choice for the next turn. */
export function sessionProviderHistory(session: ProviderHistoryInput): SessionProviderHistory {
  if (!session.blocks && session.providerHistory) return session.providerHistory;
  const blocks = session.blocks ?? [];
  let inferred =
    blocks.find((block) => block.handoff)?.handoff?.from ??
    session.pendingSwitch?.from ??
    session.harness;
  const providers: HarnessId[] = [];
  let activeHarness: HarnessId | undefined;
  let handedOffFrom: HarnessId | undefined;
  let activeModel: string | undefined;
  const use = (harness: HarnessId) => {
    if (!providers.includes(harness)) providers.push(harness);
    if (activeHarness && activeHarness !== harness) handedOffFrom = activeHarness;
    activeHarness = harness;
  };
  for (const block of blocks) {
    if (block.handoff?.status === "ready" && !block.handoff.pending) {
      inferred = block.handoff.to;
    }
    if (submittedProviderTurn(block)) {
      use(block.turnModel?.harness ?? inferred);
      activeModel = block.turnModel?.name || block.turnModel?.id;
    }
  }
  if (session.runningModelTarget) {
    use(session.runningModelTarget.harness);
    activeModel = session.runningModelTarget.model;
  }
  if (!activeHarness) use(session.pendingSwitch?.from ?? session.harness);
  return {
    providers,
    activeHarness: activeHarness!,
    ...(activeModel ? { activeModel } : {}),
    ...(handedOffFrom ? { handedOffFrom } : {}),
  };
}

function submittedProviderTurn(block: Block): boolean {
  return (
    block.role === "user" &&
    !block.draft &&
    !block.workspacePreparationPending &&
    !block.followUpDelivery
  );
}
