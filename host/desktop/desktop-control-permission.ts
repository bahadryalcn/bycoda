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
  driver: "agent-desktop",
  version: 0,
};

/** Anything but a stored "full" reads as "ask". Full access always covers every app; the stored
 * `allowAllApps` value is ignored. */
export function normalizeDesktopConfiguration(
  raw: Partial<DesktopControlConfiguration>,
): DesktopControlConfiguration {
  const mode: DesktopPermissionMode = raw.permissionMode === "full" ? "full" : "ask";
  return {
    ...EMPTY_DESKTOP_CONFIGURATION,
    ...raw,
    permissionMode: mode,
    allowAllApps: mode === "full",
    driver: raw.driver === "cua-driver" ? "cua-driver" : "agent-desktop",
  };
}

/** A plain app name that is safe to pass to the helper and to show in an approval. */
export function isPlainDesktopAppName(app: string) {
  return (
    !!app.trim() && app.length <= 200 && !app.startsWith("-") && !hasControlCharacters(app, false)
  );
}

/** Windows reports process names such as "chrome.exe"; owners and models say "Chrome" or
 * "chrome". On Windows names compare case-insensitively with an optional ".exe"; elsewhere exactly. */
export function sameDesktopApp(a: string, b: string, platform: NodeJS.Platform = process.platform) {
  if (platform !== "win32") return a === b;
  const key = (name: string) =>
    name
      .trim()
      .toLowerCase()
      .replace(/\.exe$/, "");
  return key(a) === key(b);
}

export function isDesktopAppAllowed(
  configuration: DesktopControlConfiguration,
  app: string,
  platform: NodeJS.Platform = process.platform,
) {
  return (
    configuration.allowAllApps ||
    configuration.allowedApps.some((allowed) => sameDesktopApp(allowed, app, platform))
  );
}

export type DesktopGate = {
  /** The exact native approval dialog must be answered before the effect. */
  ask: boolean;
  /** The owner must be at the desktop (headed input, clipboard) unless the mode is full. */
  requirePresence: boolean;
};

/** One table for both owner-set modes. Locked/unknown desktop, Stop and disabled control are
 * blocked elsewhere in every mode. In ask mode an app the owner has not approved yet is asked
 * for once by the conversation gate, and every effect then asks again. */
export function desktopGate(input: {
  mode: DesktopPermissionMode;
  kind: "act" | "launch" | "clipboard";
  headed: boolean;
}): DesktopGate {
  if (input.mode === "full") return { ask: false, requirePresence: false };
  return {
    ask: true,
    requirePresence: (input.kind === "act" && input.headed) || input.kind === "clipboard",
  };
}

export function desktopGatePermits(
  gate: DesktopGate,
  state: { approved: boolean; ownerPresent: boolean | undefined },
): boolean {
  return (!gate.ask || state.approved) && (!gate.requirePresence || state.ownerPresent === true);
}
