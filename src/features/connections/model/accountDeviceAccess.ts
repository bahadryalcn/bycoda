import { AccountApiError, HostDeviceAccessSync } from "@bycoda/account-contracts";
import { accountApi } from "../../account";
import { createStoredSetting } from "../../../shared/lib/storedSetting";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { remoteRequest } from "./connections";
import { readPairedDevices } from "./pairedDevices";
import type { HostDescriptor, RemoteMachine } from "./protocol";

export const accountDeviceAccess = createStoredSetting<string>({
  key: "bycoda.connections.accountDeviceAccess",
  fallback: "",
  parse: (value) => value,
  serialize: (value) => value,
  event: "bycoda:account-device-access",
  storageEvents: true,
});

let syncLane: Promise<void> = Promise.resolve();

/** Synchronizes with the account while the owner is signed in on the Host's desktop. */
export function startAccountDeviceAccess(
  deviceId: string,
  localMachine: () => Promise<RemoteMachine | null>,
  onError: (error: unknown) => void,
) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const api = accountApi();
  const params = { id: deviceId };
  const enabled = () => !stopped && accountDeviceAccess.load() === deviceId;
  const disabled = () => !stopped && accountDeviceAccess.load() === `off:${deviceId}`;

  async function sync() {
    if (disabled()) {
      await api.disableHostDeviceAccess({ params });
      if (disabled()) accountDeviceAccess.save("");
      return;
    }
    if (!enabled()) return;
    const machine = await localMachine();
    if (!machine?.environmentId || !enabled()) return;
    const id = machine.environmentId;
    const host = await remoteRequest<HostDescriptor>(
      machine.id,
      "environment.describe",
      {},
      false,
      false,
      id,
    );
    if (!host.capabilities?.includes("devices.applyRecovery")) return;
    const read = async () =>
      readPairedDevices(await remoteRequest(machine.id, "devices.paired", {}, false, false, id));
    const initial = await read();
    if (!enabled() || !initial.devices.some((row) => row.isCurrent && row.isLocalDesktop)) return;
    const snapshot = (inventory: typeof initial, applied: string[]) =>
      HostDeviceAccessSync.parse({
        environmentId: id,
        name: truncateGraphemes(host.name.trim(), 160, "") || machine.name,
        devices: inventory.devices
          .filter((row) => !row.isLocalDesktop)
          .map((row) => ({
            id: row.id,
            name: row.name,
            canManageDevices: row.canManageDevices === true,
          })),
        applied,
      });
    const { pending } = await api.syncHostDeviceAccess({ params, body: snapshot(initial, []) });
    const applied: string[] = [];
    for (const request of pending) {
      if (!enabled()) return;
      const result = await remoteRequest<{ applied?: unknown }>(
        machine.id,
        "devices.applyRecovery",
        request,
        false,
        true,
        id,
      );
      if (result?.applied === true) applied.push(request.requestId);
    }
    if (applied.length && enabled()) {
      const inventory = await read();
      if (enabled()) await api.syncHostDeviceAccess({ params, body: snapshot(inventory, applied) });
    }
  }

  function run() {
    syncLane = syncLane
      .then(sync)
      .catch((error: unknown) => {
        if (error instanceof AccountApiError && error.status === 404) {
          stopped = true;
          return;
        }
        onError(error);
      })
      .finally(() => {
        if (!stopped && (enabled() || disabled())) timer = setTimeout(run, 15_000);
      });
  }
  run();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
