import type { ProviderRateLimits } from "../../../../shared/model/provider-quota";

type Observer = (accountId: string, limits: ProviderRateLimits) => void;
const observers = new Set<Observer>();

export function subscribeCodexQuotaObservations(observer: Observer): () => void {
  observers.add(observer);
  return () => observers.delete(observer);
}

export function emitCodexQuotaObservation(accountId: string, limits: ProviderRateLimits): void {
  for (const observer of observers) {
    try {
      observer(accountId, limits);
    } catch {
      // Quota presentation must never interrupt a provider turn.
    }
  }
}
