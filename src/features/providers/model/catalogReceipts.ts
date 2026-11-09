import { createStore } from "../../../shared/lib/store";
import { refreshHarnessCatalogs } from "../../../integrations/harness/core/registry";
import { catalogModelsFor, hasLiveCatalog } from "../../sessions/model/models";
import type { HarnessId } from "../../sessions/model/session";

/**
 * What the model list a provider shows actually is. Adapters retain older data
 * when a refresh finds nothing, so a finished refresh is not proof of a fresh
 * catalog: only a list that replaced the previous one counts as `fresh`.
 */
export type CatalogReceipt =
  | { status: "refreshing"; previous?: CatalogReceipt }
  /** A refresh replaced the list with what the CLI reported. */
  | { status: "fresh"; at: number; count: number }
  /** The refresh finished without a new list; the earlier CLI list is kept. */
  | { status: "retained"; at: number; count: number }
  /** No live list exists; the built-in list shipped with the app is shown. */
  | { status: "bundled"; at: number; count: number }
  /** The refresh failed. `count` is the list still shown, if any. */
  | { status: "error"; at: number; count: number; error: string; retained: boolean };

type Settled = Exclude<CatalogReceipt, { status: "refreshing" }>;

const receipts = new Map<HarnessId, CatalogReceipt>();
const inflight = new Map<HarnessId, Promise<Settled>>();
const listeners = createStore();
let version = 0;

function publish(harness: HarnessId, receipt: CatalogReceipt) {
  receipts.set(harness, receipt);
  version += 1;
  listeners.notify();
}

export function subscribeCatalogReceipts(listener: () => void): () => void {
  return listeners.subscribe(listener);
}

export function getCatalogReceiptsSnapshot(): number {
  return version;
}

export function getCatalogReceipt(harness: HarnessId): CatalogReceipt | undefined {
  return receipts.get(harness);
}

/** Test seam. */
export function resetCatalogReceipts() {
  receipts.clear();
  inflight.clear();
  version += 1;
}

/**
 * Refreshes one provider's model list and records what came of it. Concurrent
 * calls share one attempt; the receipt is also what Retry in Settings reads.
 */
export function refreshProviderCatalog(
  harness: HarnessId,
  options?: { force?: boolean },
): Promise<Settled> {
  const running = inflight.get(harness);
  if (running) return running;
  const previous = receipts.get(harness);
  const before = catalogModelsFor(harness);
  const hadLive = hasLiveCatalog(harness);
  publish(harness, { status: "refreshing", previous });
  const attempt = refreshHarnessCatalogs([harness], options)
    .then((): Settled => {
      const after = catalogModelsFor(harness);
      const at = Date.now();
      if (after !== before) return { status: "fresh", at, count: after.length };
      return hasLiveCatalog(harness)
        ? { status: "retained", at, count: after.length }
        : { status: "bundled", at, count: after.length };
    })
    .catch((error: unknown): Settled => ({
      status: "error",
      at: Date.now(),
      count: catalogModelsFor(harness).length,
      error: error instanceof Error ? error.message : String(error),
      retained: hadLive,
    }))
    .then((settled) => {
      inflight.delete(harness);
      publish(harness, settled);
      return settled;
    });
  inflight.set(harness, attempt);
  return attempt;
}
