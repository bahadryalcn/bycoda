import type { HarnessId } from "../../../features/sessions/model/session";
import { invokeProviderCommand } from "./child";

export type HarnessAuthStatus = "signedIn" | "signedOut" | "unknown";
const pending = new Map<string, Promise<HarnessAuthStatus>>();

/** Ask the CLI owning the selected profile. Installation or a cached identity is not login proof. */
export function readHarnessAuthStatus(
  provider: HarnessId,
  accountId?: string,
): Promise<HarnessAuthStatus> {
  const key = `${provider}:${accountId ?? "default"}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const request = Promise.resolve()
    .then(() =>
      invokeProviderCommand<HarnessAuthStatus>("harness_auth_status", {
        provider,
        accountId,
      }),
    )
    .then((status): HarnessAuthStatus =>
      status === "signedIn" || status === "signedOut" ? status : "unknown",
    )
    .catch((): HarnessAuthStatus => {
      // Older hosts, unsupported status commands and timeouts must not prompt a login.
      return "unknown";
    })
    .finally(() => {
      pending.delete(key);
    });
  pending.set(key, request);
  return request;
}
