import {
  REMOTE_PROVIDERS,
  type RemoteProvider,
} from "../../src/features/connections/model/protocol";
import { forEachConcurrent } from "../../src/shared/lib/concurrent";

/**
 * Each probe walks every PATH directory for its launcher names, so a few overlap while
 * the rest queue: antivirus-scanned Windows directories stay unsaturated.
 */
export const PROVIDER_DISCOVERY_CONCURRENCY = 3;

/**
 * Providers whose launcher resolves, in `REMOTE_PROVIDERS` order whatever order the probes
 * finish in. Each provider is probed once; a failed probe leaves it out (the descriptor
 * reports it unavailable) and never fails or cancels another provider's probe.
 */
export async function discoverAvailableProviders(
  resolve: (provider: RemoteProvider) => Promise<unknown>,
  providers: readonly RemoteProvider[] = REMOTE_PROVIDERS,
  concurrency: number = PROVIDER_DISCOVERY_CONCURRENCY,
): Promise<RemoteProvider[]> {
  // `acp` is a generic adapter configured by the owner, not a launcher found on PATH.
  const candidates = providers.filter((provider) => provider !== "acp");
  const found = new Array<boolean>(candidates.length).fill(false);
  await forEachConcurrent(candidates, concurrency, async (provider, index) => {
    try {
      await resolve(provider);
      found[index] = true;
    } catch {
      /* report via descriptor */
    }
  });
  return candidates.filter((_, index) => found[index]);
}
