import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";
import type { DesktopControlConfiguration } from "../../../../shared/model/host-contracts/desktop-control";
import { applyAssistantWorkPreset, assistantWorkPreset } from "../../model/assistantWorkPresets";

export type AssistantAccessChoice = "ask" | "full";
type ComputerAccess = Pick<
  DesktopControlConfiguration,
  "enabled" | "permissionMode" | "allowPhysicalInput"
>;
type PermissionLevel = NonNullable<AssistantProfilePatch["permissionLevel"]>;
type CriticalExclusions = NonNullable<AssistantProfilePatch["criticalExclusions"]>;

/** Restored by "Work and ask": every critical operation keeps its own approval. */
export const DEFAULT_CRITICAL_EXCLUSIONS: CriticalExclusions = [
  "pushMain",
  "deleteProject",
  "deleteSession",
  "sendMessages",
  "computerUse",
  "spend",
];

/** What `assistant_consent_get` returns; `active` is false for another Host credential. */
export type NativeConsentGrant = {
  revision: number;
  active?: boolean;
  permissionLevel: PermissionLevel;
  projectIds?: string[];
  criticalExclusions: CriticalExclusions;
};

/**
 * The permission the native app enforces for the selected Host. Host profiles only mirror it.
 * `missing` and `other-credentials` both prompt for every operation until the owner renews.
 */
export type NativeConsent =
  | { state: "loading" }
  | { state: "failed" }
  | { state: "missing" }
  | { state: "other-credentials"; permissionLevel: PermissionLevel }
  | {
      state: "active";
      permissionLevel: PermissionLevel;
      criticalExclusions: CriticalExclusions;
    };

export function nativeConsentFromGrant(grant: NativeConsentGrant | null): NativeConsent {
  if (!grant) return { state: "missing" };
  if (grant.active === false)
    return { state: "other-credentials", permissionLevel: grant.permissionLevel };
  return {
    state: "active",
    permissionLevel: grant.permissionLevel,
    criticalExclusions: grant.criticalExclusions,
  };
}

/**
 * The level and exclusions in force. An unsaved owner choice shows what Save will grant;
 * otherwise only the native grant counts, so a Host mirror never makes a label say "full".
 */
export function effectiveConsent(
  native: NativeConsent,
  draft: Pick<AssistantProfilePatch, "permissionLevel" | "criticalExclusions">,
  changed: boolean,
): { level: PermissionLevel | undefined; exclusions: CriticalExclusions } | "loading" {
  if (native.state === "loading" || native.state === "failed") return "loading";
  if (changed)
    return {
      level: draft.permissionLevel,
      exclusions: draft.criticalExclusions ?? DEFAULT_CRITICAL_EXCLUSIONS,
    };
  if (native.state === "active")
    return { level: native.permissionLevel, exclusions: native.criticalExclusions };
  return { level: "ask", exclusions: DEFAULT_CRITICAL_EXCLUSIONS };
}

/** A label describes every current draft and the native grant, never just the job permission. */
export function assistantAccessMode(
  profile: AssistantProfilePatch,
  computer: ComputerAccess | undefined,
  commands: boolean | undefined,
  changes = false,
  consent: ReturnType<typeof effectiveConsent> = "loading",
): AssistantAccessChoice | "custom" | "loading" {
  if (!computer || commands === undefined || consent === "loading") return "loading";
  if (!computer.enabled || !computer.allowPhysicalInput) return "custom";
  const work = assistantWorkPreset(profile);
  if (
    profile.execution &&
    work === "free" &&
    computer.permissionMode === "full" &&
    commands &&
    changes &&
    consent.level === "everything" &&
    consent.exclusions.length === 0
  )
    return "full";
  if (
    profile.execution &&
    work === "ask" &&
    computer.permissionMode === "ask" &&
    !commands &&
    !changes &&
    consent.level === "ask"
  )
    return "ask";
  return "custom";
}

/**
 * Called only by an explicit owner choice; mounting settings never expands grants.
 * Full access grants everything with no critical exclusions (the owner may re-add some);
 * Work and ask drops any broad grant and restores every exclusion.
 */
export function assistantAccessPatch(
  profile: AssistantProfilePatch,
  choice: AssistantAccessChoice,
): AssistantProfilePatch {
  return {
    ...applyAssistantWorkPreset(profile, choice === "full" ? "free" : "ask"),
    permissionLevel: choice === "full" ? "everything" : "ask",
    permissionProjectIds: [],
    criticalExclusions: choice === "full" ? [] : [...DEFAULT_CRITICAL_EXCLUSIONS],
  };
}
