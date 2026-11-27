import { invoke } from "@tauri-apps/api/core";
import {
  nativeConsentFromGrant,
  type NativeConsent,
  type NativeConsentGrant,
} from "../ui/settings/assistantAccess";

type CriticalKey = Extract<NativeConsent, { state: "active" }>["criticalExclusions"][number];

/** Public read-only contract: the native standing consent for the local Host. */
export type StandingConsent = {
  /** Level "everything" with no critical exclusions on the active credential. */
  fullAccess: boolean;
  /** True when the owner keeps asking for this operation (or consent is not known). */
  excludes(key: CriticalKey): boolean;
};

const CLOSED: StandingConsent = { fullAccess: false, excludes: () => true };

/** Pure mapping; loading, failed, missing and other-credential states never grant access. */
export function standingConsentFrom(native: NativeConsent): StandingConsent {
  if (native.state !== "active") return CLOSED;
  const excluded = new Set<string>(native.criticalExclusions);
  return {
    fullAccess: native.permissionLevel === "everything" && excluded.size === 0,
    excludes: (key) => native.permissionLevel !== "everything" || excluded.has(key),
  };
}

/**
 * Reads the grant fresh from the native store (no cache, so a grant saved in settings applies
 * immediately). Any failure resolves to a closed consent: fail closed, never throws.
 */
export async function readStandingConsent(environmentId?: string): Promise<StandingConsent> {
  try {
    const id =
      environmentId ??
      (await invoke<{ environmentId?: string } | null>("local_host_connect"))?.environmentId;
    if (!id) return CLOSED;
    const grant = await invoke<NativeConsentGrant | null>("assistant_consent_get", {
      environmentId: id,
    });
    return standingConsentFrom(nativeConsentFromGrant(grant));
  } catch {
    return CLOSED;
  }
}
