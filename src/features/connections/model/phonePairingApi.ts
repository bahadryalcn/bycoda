import { remoteRequest } from "./connections";
import {
  readMobileAccessStatus,
  readPhonePairingCreated,
  readPhonePairingStatus,
} from "./phonePairingContract";
import { publicPhoneAccess } from "./publicPhoneAccess";
import { externalTunnelApi, readTunnelOverview } from "./externalTunnelController";
import type { PhonePairingApi } from "./phonePairingTypes";

export const phonePairingApi: PhonePairingApi = {
  async access(machine, mode = "lan") {
    if (mode === "public")
      return publicPhoneAccess(
        readTunnelOverview(await externalTunnelApi(machine).status(true), machine.environmentId),
      );
    const status = readMobileAccessStatus(
      await remoteRequest(machine.id, "mobile.access.status", { mode }, true, true),
    );
    if (status.mode !== mode) throw new Error("Unsupported method: phone access listener");
    return status;
  },
  async enable(machine, mode = "lan", address) {
    return readMobileAccessStatus(
      await remoteRequest(machine.id, "mobile.access.enable", { mode, address }, false, true),
    );
  },
  async disable(machine, mode = "lan") {
    return readMobileAccessStatus(
      await remoteRequest(machine.id, "mobile.access.disable", { mode }, false, true),
    );
  },
  async create(machine, kind = "phone") {
    return readPhonePairingCreated(
      await remoteRequest(machine.id, "mobile.pairing.create", { kind }, false, true),
      machine,
    );
  },
  async status(machine, pairingId) {
    return readPhonePairingStatus(
      await remoteRequest(machine.id, "mobile.pairing.status", { pairingId }),
    );
  },
  async cancel(machine, pairingId) {
    await remoteRequest(machine.id, "mobile.pairing.cancel", { pairingId });
  },
};
