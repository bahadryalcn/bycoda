import {
  type DesktopControlConfiguration,
  type DesktopPermissionMode,
} from "../../src/shared/model/host-contracts/desktop-control";
import { hasControlCharacters } from "../../src/shared/lib/controlCharacters";

export const EMPTY_DESKTOP_CONFIGURATION: DesktopControlConfiguration = {
  enabled: false,
  binaryPath: "",
  binarySha256: "",
  allowedApps: [],
  allowPhysicalInput: false,
  permissionMode: "ask",
  allowAllApps: false,
  version: 0,
};

/** Old stored rows have no mode; they read as "ask". Full access always covers every app; the
 * stored `allowAllApps` value is ignored. */
export function normalizeDesktopConfiguration(
  raw: Partial<DesktopControlConfiguration>,
): DesktopControlConfiguration {
  const mode: DesktopPermissionMode =
    raw.permissionMode === "auto" || raw.permissionMode === "full" ? raw.permissionMode : "ask";
  return {
    ...EMPTY_DESKTOP_CONFIGURATION,
    ...raw,
    permissionMode: mode,
    allowAllApps: mode === "full",
  };
}

/** A plain app name that is safe to pass to the helper and to show in an approval. */
export function isPlainDesktopAppName(app: string) {
  return (
    !!app.trim() && app.length <= 200 && !app.startsWith("-") && !hasControlCharacters(app, false)
  );
}

export function isDesktopAppAllowed(configuration: DesktopControlConfiguration, app: string) {
  return configuration.allowedApps.includes(app) || configuration.allowAllApps;
}

export type DesktopGate = {
  /** The exact native approval dialog must be answered before the effect. */
  ask: boolean;
  /** The owner must be at the desktop (headed input, clipboard) unless the mode is full. */
  requirePresence: boolean;
};

/** One table for every owner-configurable mode. Locked/unknown desktop, Stop and disabled control
 * are blocked elsewhere in every mode. An app the owner has not approved yet is asked for once
 * by the conversation gate (ask and auto); auto then launches and acts on it without a dialog. */
export function desktopGate(input: {
  mode: DesktopPermissionMode;
  kind: "act" | "launch" | "clipboard";
  headed: boolean;
}): DesktopGate {
  if (input.mode === "full") return { ask: false, requirePresence: false };
  const physical = input.kind === "act" && input.headed;
  return {
    ask: input.mode === "ask" || input.kind === "clipboard" || physical,
    requirePresence: physical || input.kind === "clipboard",
  };
}

export function desktopGatePermits(
  gate: DesktopGate,
  state: { approved: boolean; ownerPresent: boolean | undefined },
): boolean {
  return (!gate.ask || state.approved) && (!gate.requirePresence || state.ownerPresent === true);
}
