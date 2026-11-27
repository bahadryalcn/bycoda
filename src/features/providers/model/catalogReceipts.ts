import { errorText } from "../../../shared/lib/errors";
import { createStore } from "../../../shared/lib/store";
import { refreshHarnessCatalogsStrict } from "../../../integrations/harness/core/registry";
import { catalogModelsFor, hasLiveCatalog } from "../../sessions/model/models";
import type { HarnessId } from "../../sessions/model/session";

/**
 * What the model list a provider shows actually is. A failed probe or an empty answer
 * rejects the refresh and keeps the earlier list (`error`); only a probe that listed
 * models counts as `fresh`, and a skipped probe is `retained`.
 */
export type CatalogReceipt =
  | { status: "refreshing"; previous?: CatalogReceipt }
  /** A probe just listed these models, whether or not they differ from before. */
  | { status: "fresh"; at: number; count: number }
  /** No probe ran (a live list was already loaded); the earlier CLI list is kept. */
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
  const hadLive = hasLiveCatalog(harness);
  publish(harness, { status: "refreshing", previous });
  const attempt = refreshHarnessCatalogsStrict([harness], options)
    .then((probed): Settled => {
      const after = catalogModelsFor(harness);
      const at = Date.now();
      // A probe that answered with the same list still verified it, so it is fresh;
      // a skipped probe (live list, no force) verified nothing.
      if (probed.has(harness) && hasLiveCatalog(harness)) {
        return { status: "fresh", at, count: after.length };
      }
      return hasLiveCatalog(harness)
        ? { status: "retained", at, count: after.length }
        : { status: "bundled", at, count: after.length };
    })
    .catch((error: unknown): Settled => ({
      status: "error",
      at: Date.now(),
      count: catalogModelsFor(harness).length,
      error: errorText(error),
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
