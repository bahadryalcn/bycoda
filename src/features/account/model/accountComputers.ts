import type { AccountClient, Computer } from "@bycoda/account-contracts";
import { accountApi, reportAccountFailure } from "./accountApi";

/**
 * The account's other computers that advertise connect info, this desktop excluded. Failures go
 * through the account controller (revoked device, expired session) and then rethrow.
 */
export async function listOtherComputers(
  ownDeviceId: string | null,
  api: Pick<AccountClient, "listComputers"> = accountApi(),
): Promise<Computer[]> {
  try {
    const { items } = await api.listComputers();
    return items.filter((computer) => computer.deviceId !== ownDeviceId);
  } catch (error) {
    await reportAccountFailure(error).catch(() => undefined);
    throw error;
  }
}
