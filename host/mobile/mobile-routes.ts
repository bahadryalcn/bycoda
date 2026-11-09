import type { MobileAccessStatus } from "../../src/integrations/mobile-access";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";

export type MobileRoute = { endpoint: string; lanKey?: string };

/** `tailscale status` and `serve status` run the CLI twice; describe is polled. */
const TAILSCALE_TTL_MS = 60_000;

/**
 * The ways a paired phone can reach this Host, advertised in
 * `environment.describe` so a phone paired over one learns the others. Only
 * endpoints and the LAN listener's public key: the phone's device credential
 * already works on every route, and each route still authenticates.
 */
export function createMobileRoutes(dependencies: {
  lan: () => Promise<MobileAccessStatus>;
  tailscale: () => Promise<MobileAccessStatus>;
}) {
  let tailscale: { at: number; endpoint: Promise<string | undefined> } | undefined;
  return async function mobileRoutes(): Promise<MobileRoute[]> {
    if (!tailscale || elapsedSince(tailscale.at) >= TAILSCALE_TTL_MS)
      tailscale = {
        at: monotonicNow(),
        endpoint: dependencies
          .tailscale()
          .then((status) => (status.state === "ready" ? status.endpoint : undefined))
          .catch(() => undefined),
      };
    const [lan, tailnet] = await Promise.all([
      dependencies.lan().catch(() => undefined),
      tailscale.endpoint,
    ]);
    return [
      ...(lan?.state === "ready" && lan.endpoint && lan.lanKey
        ? [{ endpoint: lan.endpoint, lanKey: lan.lanKey }]
        : []),
      ...(tailnet ? [{ endpoint: tailnet }] : []),
    ];
  };
}
