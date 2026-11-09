import type { HarnessId } from "../../../features/sessions/model/session";
import { invokeProviderCommand } from "./child";
import { observeProviderOperation } from "./providerObservation";

export type HarnessAuthStatus = "signedIn" | "signedOut" | "unknown";
const pending = new Map<
  string,
  {
    actual: Promise<HarnessAuthStatus>;
    observed: Promise<HarnessAuthStatus>;
  }
>();

/** Ask the CLI owning the selected profile. Installation or a cached identity is not login proof. */
export function readHarnessAuthStatus(
  provider: HarnessId,
  accountId?: string,
): Promise<HarnessAuthStatus> {
  const key = `${provider}:${accountId ?? "default"}`;
  const existing = pending.get(key);
  if (existing) return existing.observed;
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
    });
  const observed = observeProviderOperation(request, 15_000, "Provider sign-in check").catch(
    (): HarnessAuthStatus => "unknown",
  );
  pending.set(key, { actual: request, observed });
  // A visible timeout cannot authorize a duplicate CLI invocation. Retain this
  // original until its actual backend operation settles, independently of UI.
  void request.finally(() => {
    if (pending.get(key)?.actual === request) pending.delete(key);
  });
  return observed;
}
