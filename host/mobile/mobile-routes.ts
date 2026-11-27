import type { MobileAccessStatus } from "../../src/integrations/mobile-access";

/**
 * A keyed route is the encrypted phone listener the phone pins by `lanKey`. A `public` route is
 * an https tunnel address anyone on the internet can reach; only the device credential
 * protects it, so it is advertised only while the owner allows phones over public tunnels.
 */
export type MobileRoute = { endpoint: string; lanKey: string } | { endpoint: string; public: true };

/**
 * The ways a paired phone can reach this Host, advertised in `environment.describe` so a
 * phone paired over one learns the other: the local network listener and the tailnet
 * listener. Both are the encrypted phone listener, so each route carries its public key and
 * the phone pins it. A public tunnel is never a phone route (the tunnel ingress refuses phone
 * credentials). The phone's device credential already works on every route.
 */
export function createMobileRoutes(dependencies: {
  lan: () => Promise<MobileAccessStatus>;
  tailnet: () => Promise<MobileAccessStatus>;
  publicUrls?: () => string[];
}) {
  const route = async (read: () => Promise<MobileAccessStatus>): Promise<MobileRoute[]> => {
    const status = await read().catch(() => undefined);
    return status?.state === "ready" && status.endpoint && status.lanKey
      ? [{ endpoint: status.endpoint, lanKey: status.lanKey }]
      : [];
  };
  return async function mobileRoutes(): Promise<MobileRoute[]> {
    const [lan, tailnet] = await Promise.all([
      route(dependencies.lan),
      route(dependencies.tailnet),
    ]);
    const publicRoutes = (dependencies.publicUrls?.() ?? [])
      .filter((endpoint) => endpoint.startsWith("https://"))
      .map((endpoint) => ({ endpoint, public: true as const }));
    return [...lan, ...tailnet, ...publicRoutes];
  };
}
