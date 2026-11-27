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

type ProviderWalk = {
  providers: HarnessId[];
  activeHarness?: HarnessId;
  activeModel?: string;
  handedOffFrom?: HarnessId;
};

// Block arrays are immutable snapshots, so a walk rides on the array identity:
// the sidebar re-reads every live session on each change, and only the session
// whose transcript changed pays for a new walk. `start` is the provider the walk
// begins from, which is the only other input that can change its result.
const walkByBlocks = new WeakMap<readonly Block[], { start: HarnessId; walk: ProviderWalk }>();

/** Submitted turn provenance wins over a composer choice for the next turn. */
export function sessionProviderHistory(session: ProviderHistoryInput): SessionProviderHistory {
  if (!session.blocks && session.providerHistory) return session.providerHistory;
  const blocks = session.blocks ?? [];
  const start =
    blocks.find((block) => block.handoff)?.handoff?.from ??
    session.pendingSwitch?.from ??
    session.harness;
  const walked = walkBlocks(blocks, start);
  // Copy the cached walk: the tail below mutates the state for the live target.
  const state: ProviderWalk = { ...walked, providers: [...walked.providers] };
  if (session.runningModelTarget) {
    recordHarness(state, session.runningModelTarget.harness);
    state.activeModel = session.runningModelTarget.model;
  }
  if (!state.activeHarness) recordHarness(state, session.pendingSwitch?.from ?? session.harness);
  return {
    providers: state.providers,
    activeHarness: state.activeHarness!,
    ...(state.activeModel ? { activeModel: state.activeModel } : {}),
    ...(state.handedOffFrom ? { handedOffFrom: state.handedOffFrom } : {}),
  };
}

/** Value equality for two provider summaries; the sidebar compares them per streamed frame. */
export function sameSessionProviderHistory(
  a: SessionProviderHistory | undefined,
  b: SessionProviderHistory | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.activeHarness === b.activeHarness &&
    a.activeModel === b.activeModel &&
    a.handedOffFrom === b.handedOffFrom &&
    a.providers.length === b.providers.length &&
    a.providers.every((harness, index) => harness === b.providers[index])
  );
}

function walkBlocks(blocks: readonly Block[], start: HarnessId): ProviderWalk {
  const cached = walkByBlocks.get(blocks);
  if (cached?.start === start) return cached.walk;
  const walk: ProviderWalk = { providers: [] };
  let inferred = start;
  for (const block of blocks) {
    if (block.handoff?.status === "ready" && !block.handoff.pending) {
      inferred = block.handoff.to;
    }
    if (submittedProviderTurn(block)) {
      recordHarness(walk, block.turnModel?.harness ?? inferred);
      walk.activeModel = block.turnModel?.name || block.turnModel?.id;
    }
  }
  walkByBlocks.set(blocks, { start, walk });
  return walk;
}

function recordHarness(walk: ProviderWalk, harness: HarnessId): void {
  if (!walk.providers.includes(harness)) walk.providers.push(harness);
  if (walk.activeHarness && walk.activeHarness !== harness) walk.handedOffFrom = walk.activeHarness;
  walk.activeHarness = harness;
}

function submittedProviderTurn(block: Block): boolean {
  return (
    block.role === "user" &&
    !block.draft &&
    !block.workspacePreparationPending &&
    !block.followUpDelivery
  );
}
