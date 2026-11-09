import type { MobileAccessStatus } from "../../../integrations/mobile-access";
import { phonePairingApi } from "./phonePairingApi";
import { phonePairingCode } from "./phonePairingContract";
import type { PhonePairingApi } from "./phonePairingTypes";
import type { RemoteMachine } from "./protocol";

/**
 * The pairing code the QR flow would show, for a phone that asked through the account: the
 * Tailscale HTTPS route when it is ready (reachable from anywhere), otherwise the local-network
 * route. The code carries one endpoint; the phone learns the other routes from
 * `environment.describe` once connected. The ticket comes from the same
 * owner-gated `mobile.pairing.create`; `cancel` releases it when the handoff fails.
 */
export async function createAccountPairingCode(
  machine: RemoteMachine,
  api: PhonePairingApi = phonePairingApi,
) {
  let access: MobileAccessStatus | undefined = await api
    .access(machine, "tailscale")
    .catch(() => undefined);
  if (access?.state !== "ready") access = await api.access(machine, "lan");
  if (access.state !== "ready")
    throw new Error("Phone access is not set up. Open Connect your phone first.");
  const created = await api.create(machine);
  return {
    code: phonePairingCode(machine, access, created),
    cancel: () => api.cancel(machine, created.pairingId),
  };
}
