import {
  type DesktopControlConfiguration,
  type DesktopPermissionMode,
} from "../../src/shared/model/host-contracts/desktop-control";

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

/** Old stored rows have no mode; they read as "ask". "Allow all apps" only exists in full access. */
export function normalizeDesktopConfiguration(
  raw: Partial<DesktopControlConfiguration>,
): DesktopControlConfiguration {
  const mode: DesktopPermissionMode =
    raw.permissionMode === "auto" || raw.permissionMode === "full" ? raw.permissionMode : "ask";
  return {
    ...EMPTY_DESKTOP_CONFIGURATION,
    ...raw,
    permissionMode: mode,
    allowAllApps: mode === "full" && raw.allowAllApps === true,
  };
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

/** One table for every owner-configurable mode. Locked/unknown desktop, Stop, disabled control
 * and non-allowed apps are blocked elsewhere in every mode. */
export function desktopGate(input: {
  mode: DesktopPermissionMode;
  kind: "act" | "launch" | "clipboard";
  headed: boolean;
}): DesktopGate {
  if (input.mode === "full") return { ask: false, requirePresence: false };
  const physical = input.kind === "act" && input.headed;
  return {
    ask: input.mode === "ask" || input.kind !== "act" || physical,
    requirePresence: physical || input.kind === "clipboard",
  };
}

export function desktopGatePermits(
  gate: DesktopGate,
  state: { approved: boolean; ownerPresent: boolean | undefined },
): boolean {
  return (!gate.ask || state.approved) && (!gate.requirePresence || state.ownerPresent === true);
}
