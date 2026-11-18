import type { MobileAccessStatus } from "../../src/integrations/mobile-access";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import { withTimeout } from "../../src/shared/lib/withTimeout";

export type MobileRoute = { endpoint: string; lanKey?: string };

/** `tailscale status` and `serve status` run the CLI twice; describe is polled. */
const TAILSCALE_TTL_MS = 60_000;
/** A failed probe is tried again sooner than a good answer is refreshed. */
const TAILSCALE_RETRY_MS = 5_000;

/**
 * The ways a paired phone can reach this Host, advertised in
 * `environment.describe` so a phone paired over one learns the others. Only
 * endpoints and the LAN listener's public key: the phone's device credential
 * already works on every route, and each route still authenticates.
 */
export function createMobileRoutes(dependencies: {
  lan: () => Promise<MobileAccessStatus>;
  tailscale: () => Promise<MobileAccessStatus>;
  tunnel?: () => string | undefined;
}) {
  let tailscale:
    | { at: number; pending: boolean; endpoint: Promise<string | undefined> }
    | undefined;
  // The last definite answer. A CLI hiccup (`unavailable`, a throw) keeps it and retries
  // soon; only `ready`, `setup-required` and `install-required` replace it.
  let known: string | undefined;
  let ttl = TAILSCALE_TTL_MS;
  return async function mobileRoutes(): Promise<MobileRoute[]> {
    if (!tailscale || (!tailscale.pending && elapsedSince(tailscale.at) >= ttl)) {
      const probe = {
        at: monotonicNow(),
        pending: true,
        endpoint: dependencies
          .tailscale()
          .then((status) => {
            if (status.state === "ready") known = status.endpoint;
            else if (status.state === "setup-required" || status.state === "install-required")
              known = undefined;
            else {
              ttl = TAILSCALE_RETRY_MS;
              return known;
            }
            ttl = TAILSCALE_TTL_MS;
            return known;
          })
          .catch(() => {
            ttl = TAILSCALE_RETRY_MS;
            return known;
          })
          .finally(() => {
            probe.pending = false;
            probe.at = monotonicNow();
          }),
      };
      tailscale = probe;
    }
    const [lan, tailnet] = await Promise.all([
      dependencies.lan().catch(() => undefined),
      // Route advertisement is optional; it must not stall Host discovery or
      // start another CLI while the original probe is still running.
      withTimeout(tailscale.endpoint, 250, "Mobile route discovery").catch(() => undefined),
    ]);
    const tunnel = dependencies.tunnel?.();
    return [
      ...(lan?.state === "ready" && lan.endpoint && lan.lanKey
        ? [{ endpoint: lan.endpoint, lanKey: lan.lanKey }]
        : []),
      ...(tailnet ? [{ endpoint: tailnet }] : []),
      ...(tunnel ? [{ endpoint: tunnel }] : []),
    ];
  };
}
