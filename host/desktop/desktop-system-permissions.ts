import { z } from "zod";
import {
  AGENT_DESKTOP_PROTOCOL,
  type DesktopSystemPermissionsReport,
} from "../../src/shared/model/host-contracts/desktop-control";
import { nativeRun, type DesktopRunner } from "./desktop-control-runner";
import { isoTimestamp } from "../../src/shared/lib/time/timestamps";

const stateSchema = z
  .enum(["granted", "denied", "not_determined", "restricted", "not_required", "unknown"])
  .transform(
    (state) => state.replaceAll("_", "-") as DesktopSystemPermissionsReport["accessibility"],
  );
const permissionsEnvelope = z.object({
  version: z.literal(AGENT_DESKTOP_PROTOCOL),
  ok: z.literal(true),
  command: z.literal("permissions"),
  data: z.object({
    accessibility: z.object({ state: stateSchema }),
    screen_recording: z.object({ state: stateSchema }),
  }),
});

/** Metadata only: never requests a grant, starts a session, or changes active input state. */
export class DesktopSystemPermissions {
  private cache?: { key: string; expires: number; value: Promise<DesktopSystemPermissionsReport> };
  constructor(
    private readonly run: DesktopRunner = nativeRun,
    private readonly now = Date.now,
  ) {}

  async read(binary?: string, digest?: string): Promise<DesktopSystemPermissionsReport> {
    const unavailable = (): DesktopSystemPermissionsReport => ({
      accessibility: "unknown",
      screenRecording: "unknown",
      source: "unavailable",
      checkedAt: isoTimestamp(this.now()) ?? "",
    });
    if (!binary || !digest) {
      this.cache = undefined;
      return unavailable();
    }
    const key = JSON.stringify([binary, digest]);
    if (this.cache?.key === key && this.now() < this.cache.expires) return this.cache.value;
    const value = (async () => {
      try {
        // The probe must not inherit helper overrides or log settings from the Host.
        const env: NodeJS.ProcessEnv = { ...process.env };
        for (const key of Object.keys(env))
          if (/^AGENT_DESKTOP_/i.test(key) || key.toUpperCase() === "RUST_LOG") delete env[key];
        const result = await this.run(binary, ["permissions"], {
          signal: AbortSignal.timeout(5000),
          timeoutMs: 5000,
          maxBuffer: 65536,
          env,
        });
        if (result.exitCode !== 0 || Buffer.byteLength(result.stdout, "utf8") > 65536)
          return unavailable();
        const { data } = permissionsEnvelope.parse(JSON.parse(result.stdout));
        // shortcut: the pinned helper does not report process elevation; omit until upstream exposes it.
        return {
          accessibility: data.accessibility.state,
          screenRecording: data.screen_recording.state,
          source: "agent-desktop" as const,
          checkedAt: isoTimestamp(this.now()) ?? "",
        };
      } catch {
        return unavailable();
      }
    })();
    this.cache = { key, expires: this.now() + 5000, value };
    return value;
  }
}

export const TARGET_ELEVATED_MESSAGE =
  "This window runs as administrator. Windows blocks other apps from controlling it unless bycoda also runs as administrator.";

/** Only explicit Windows integrity evidence is mapped; generic PERM_DENIED can be a file ACL. */
export function normalizeDesktopError<
  T extends { code: string; message?: string; platform_detail?: string },
>(error: T, platform: NodeJS.Platform = process.platform): T & { message?: string } {
  const detail = [error.code, error.message, error.platform_detail].filter(Boolean).join(" ");
  if (
    platform === "win32" &&
    /E_ACCESSDENIED|0x80070005|\bUIPI\b|higher[- ]integrity|(?:window|target).*(?:elevated|administrator)/i.test(
      detail,
    )
  )
    return { ...error, code: "target-elevated", message: TARGET_ELEVATED_MESSAGE };
  return error;
}
