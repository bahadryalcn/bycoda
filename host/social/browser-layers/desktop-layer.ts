import type { SocialPlatform } from "../../../src/features/social/model/social";
import type { BrowserSettings } from "./browser-settings";

/** The owner counts as away after this much input idle time on the computer. */
export const DESKTOP_IDLE_MS = 10 * 60_000;

/** Presence of the computer a desktop task would use. Undefined means unknown, which fails closed. */
export type DesktopPresenceReading = {
  supported: boolean;
  locked: boolean;
  idleMs?: number;
  /** Owner status is "away" on the account. */
  awayStatus?: boolean;
};

export type DesktopGateInput = {
  settings: BrowserSettings;
  /** `false` only for a single job. `undefined` or `true` (outreach or sequence) never uses the desktop. */
  outreach: boolean | undefined;
  presence: DesktopPresenceReading | undefined;
  /** The computer the owner is working on right now, if the Host knows it. */
  ownerActiveComputerId?: string;
};

export type DesktopSkipReason =
  | "not_allowed"
  | "no_computer"
  | "outreach"
  | "presence_unknown"
  | "locked"
  | "owner_active"
  | "owner_screen";

export type DesktopGateResult =
  | { ok: true; computerId: string }
  | { ok: false; reason: DesktopSkipReason };

/**
 * Owner decision D9: the desktop layer runs only when desktop control is allowed for the account, a
 * computer is selected, the task is a single job, the computer is readable and unlocked, the owner is
 * away (idle for 10 minutes or status "away"), and the selected computer is not the owner's active screen.
 */
export function desktopGate(input: DesktopGateInput): DesktopGateResult {
  const control = input.settings.desktopControl;
  if (!control.allowed) return { ok: false, reason: "not_allowed" };
  if (!control.computerId) return { ok: false, reason: "no_computer" };
  if (input.outreach !== false) return { ok: false, reason: "outreach" };
  const presence = input.presence;
  if (!presence || !presence.supported) return { ok: false, reason: "presence_unknown" };
  if (presence.locked) return { ok: false, reason: "locked" };
  const away =
    presence.awayStatus === true ||
    (presence.idleMs !== undefined && presence.idleMs >= DESKTOP_IDLE_MS);
  if (!away) return { ok: false, reason: "owner_active" };
  if (input.ownerActiveComputerId === control.computerId)
    return { ok: false, reason: "owner_screen" };
  return { ok: true, computerId: control.computerId };
}

export type DesktopLayerRequest = {
  accountId: string;
  computerId: string;
  platform: SocialPlatform;
  step: string;
};

/**
 * Adapter over the existing Host desktop control. It must refuse captcha and verification pages itself,
 * and it carries no Social principal of its own: the owner's physical-input grant is bound to the owner
 * principal, so a Social call without it reports "skipped" through the wiring.
 */
export interface DesktopLayerPort {
  run(request: DesktopLayerRequest): Promise<{ done: boolean; selector?: string }>;
}

export type DesktopLayerOutcome = {
  status: "done" | "failed" | "skipped";
  detail?: string;
  selector?: string;
};

export async function runDesktopLayer(
  port: DesktopLayerPort | undefined,
  gate: DesktopGateResult,
  request: Omit<DesktopLayerRequest, "computerId">,
): Promise<DesktopLayerOutcome> {
  if (!gate.ok) return { status: "skipped", detail: gate.reason };
  if (!port) return { status: "skipped", detail: "no_adapter" };
  try {
    const result = await port.run({ ...request, computerId: gate.computerId });
    if (!result.done) return { status: "failed", detail: "not_done" };
    return result.selector ? { status: "done", selector: result.selector } : { status: "done" };
  } catch {
    return { status: "failed", detail: "error" };
  }
}
