import type { MobileAccessStatus } from "../../../integrations/mobile-access";
import type { TunnelOverview } from "../../../integrations/external-tunnels";
import { mobilePairingEndpoint } from "../../../integrations/mobile-pairing";

/**
 * The public address a phone would pair through: the live public tunnel of this computer's Host,
 * only while the owner allows phones over the public internet. Always https and never keyed (a
 * LAN key is for private listeners); `undefined` hides the choice.
 */
export function publicPhoneEndpoint(overview: TunnelOverview | undefined): string | undefined {
  if (overview?.phonesOverPublic !== true) return undefined;
  const tunnel = overview.tunnels.find(
    (entry) => entry.target === "host" && entry.state === "ready" && entry.publicUrl,
  );
  if (!tunnel?.publicUrl) return undefined;
  try {
    const endpoint = mobilePairingEndpoint(tunnel.publicUrl);
    return endpoint.startsWith("https://") ? endpoint : undefined;
  } catch {
    return undefined;
  }
}

/** The pairing access of the public choice, in the shape the private listeners report. */
export function publicPhoneAccess(overview: TunnelOverview | undefined): MobileAccessStatus {
  const endpoint = publicPhoneEndpoint(overview);
  return endpoint ? { state: "ready", endpoint } : { state: "unavailable" };
}
