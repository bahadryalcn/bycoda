import { remoteRequest } from "./connections";
import {
  readMobileAccessStatus,
  readPhonePairingCreated,
  readPhonePairingStatus,
} from "./phonePairingContract";
import type { PhonePairingApi } from "./phonePairingTypes";

export const phonePairingApi: PhonePairingApi = {
  async access(machine, mode = "lan") {
    const status = readMobileAccessStatus(
      await remoteRequest(machine.id, "mobile.access.status", { mode }, true, true),
    );
    if (mode === "lan" && status.mode !== "lan")
      throw new Error("Unsupported method: local network phone access");
    return status;
  },
  async enable(machine, mode = "lan", address) {
    return readMobileAccessStatus(
      await remoteRequest(machine.id, "mobile.access.enable", { mode, address }, false, true),
    );
  },
  async disable(machine) {
    return readMobileAccessStatus(
      await remoteRequest(machine.id, "mobile.access.disable", { mode: "lan" }, false, true),
    );
  },
  async create(machine) {
    return readPhonePairingCreated(
      await remoteRequest(machine.id, "mobile.pairing.create", {}, false, true),
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
