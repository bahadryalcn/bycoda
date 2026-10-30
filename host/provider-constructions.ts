import { isHarnessConstructionId } from "../src/shared/model/harnessProcess";
import type { ProviderChild } from "./provider-child";

type Reservation = Readonly<{ sessionId: string }>;
type Original = Readonly<{ sessionId: string; child: ProviderChild }>;
type RecordEntry = Original & { outcome: "pending" | "verified" | "unknown" };

/** Closed routes and original cleanup receipts have different lifetimes. */
export class ProviderConstructions {
  private readonly reservations = new Set<Reservation>();
  private readonly originals = new Map<string, RecordEntry>();
  constructor(
    private readonly completion: (child: ProviderChild) => Promise<void>,
    private readonly capacity = 512,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new Error("Invalid process receipt capacity.");
  }
  reserve(sessionId: string): Reservation {
    for (const [id, entry] of this.originals) {
      if (this.originals.size + this.reservations.size < this.capacity) break;
      if (entry.outcome === "verified") this.originals.delete(id);
    }
    if (this.originals.size + this.reservations.size >= this.capacity)
      throw new Error(
        "Original provider process receipts are full; unresolved cleanup was retained.",
      );
    const reservation = Object.freeze({ sessionId });
    this.reservations.add(reservation);
    return reservation;
  }
  release(reservation: Reservation): void {
    this.reservations.delete(reservation);
  }
  publish(reservation: Reservation, constructionId: string, child: ProviderChild): void {
    if (
      !this.reservations.has(reservation) ||
      !isHarnessConstructionId(constructionId) ||
      this.originals.has(constructionId)
    )
      throw new Error("Original provider process reservation is unavailable.");
    const entry: RecordEntry = { sessionId: reservation.sessionId, child, outcome: "pending" };
    this.originals.set(constructionId, entry);
    this.reservations.delete(reservation);
    void this.completion(child).then(
      () => {
        entry.outcome = "verified";
      },
      () => {
        entry.outcome = "unknown";
      },
    );
  }
  require(sessionId: string, constructionId: unknown): Original {
    if (!isHarnessConstructionId(constructionId))
      throw new Error("Provider process identity is required.");
    const original = this.originals.get(constructionId);
    if (!original || original.sessionId !== sessionId)
      throw new Error(
        "Original provider process identity receipt is missing or no longer retained.",
      );
    return original;
  }
}
