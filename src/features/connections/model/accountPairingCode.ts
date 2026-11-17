import type { MobileAccessStatus } from "../../../integrations/mobile-access";
import { phonePairingApi } from "./phonePairingApi";
import { phonePairingCode } from "./phonePairingContract";
import type { PhonePairingApi } from "./phonePairingTypes";
import type { RemoteMachine } from "./protocol";

export type AccountPairingOptions = {
  /** Who asked. Only a computer may be given the published https tunnel route in place of a phone listener. */
  requester?: "desktop" | "phone";
  /** The Host's published https tunnel origin, read when neither Tailscale nor LAN access is ready. */
  tunnelEndpoint?: () => Promise<string | undefined>;
};

/**
 * The pairing code the QR flow would show, for a phone that asked through the account: the
 * Tailscale HTTPS route when it is ready (reachable from anywhere), otherwise the local-network
 * route; for a requesting computer, otherwise the Host's published https tunnel. The code carries one endpoint; the phone learns the other routes from
 * `environment.describe` once connected. The ticket comes from the same
 * owner-gated `mobile.pairing.create`; `cancel` releases it when the handoff fails.
 */
export async function createAccountPairingCode(
  machine: RemoteMachine,
  api: PhonePairingApi = phonePairingApi,
  options: AccountPairingOptions = {},
) {
  let access: MobileAccessStatus | undefined = await api
    .access(machine, "tailscale")
    .catch(() => undefined);
  if (access?.state !== "ready")
    access = await api.access(machine, "lan").catch((error: unknown) => {
      // A computer asking through the account can use the published https tunnel, so a failed
      // LAN check only matters when there is no tunnel to fall back to.
      if (options.requester === "desktop") return undefined;
      throw error;
    });
  if (access?.state !== "ready" && options.requester === "desktop") {
    const endpoint = await options.tunnelEndpoint?.().catch(() => undefined);
    if (endpoint) access = { state: "ready", endpoint };
  }
  if (access?.state !== "ready")
    throw new Error("Phone access is not set up. Open Connect your phone first.");
  const created = await api.create(machine, options.requester ?? "phone");
  return {
    code: phonePairingCode(machine, access, created),
    cancel: () => api.cancel(machine, created.pairingId),
  };
}
