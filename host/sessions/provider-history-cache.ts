import type { Session } from "../../src/features/sessions/model/session";
import type { BlockChanges } from "../../src/features/sessions/model/blockChanges";
import { sessionProviderHistory } from "../../src/features/sessions/model/sessionProviderHistory";

type History = ReturnType<typeof sessionProviderHistory>;
const cache = new WeakMap<Session["blocks"], { metadata: string; history: History }>();

function contribution(block: Session["blocks"][number] | null | undefined): string {
  return JSON.stringify(
    block
      ? {
          role: block.role,
          draft: block.draft,
          workspacePreparationPending: block.workspacePreparationPending,
          followUpDelivery: block.followUpDelivery,
          handoff: block.handoff,
          turnModel: block.turnModel,
        }
      : null,
  );
}

/** Only carry a cached result across a proven stable-order, equivalent edit. */
export function carryProviderHistory(
  previous: Session["blocks"],
  next: Session["blocks"],
  changes: BlockChanges,
  positions: Map<string, number>,
): void {
  const cached = cache.get(previous);
  if (!cached) return;
  for (const [id, block] of changes)
    if (contribution(previous[positions.get(id)!]) !== contribution(block)) return;
  cache.set(next, cached);
}

export function cachedProviderHistory(session: Session): History {
  const metadata = JSON.stringify([
    session.harness,
    session.pendingSwitch,
    session.runningModelTarget,
  ]);
  const cached = cache.get(session.blocks);
  if (cached?.metadata === metadata) return cached.history;
  const history = sessionProviderHistory(session);
  cache.set(session.blocks, { metadata, history });
  return history;
}
