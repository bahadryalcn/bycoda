import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { execFileAsync } from "../src/shared/lib/processExecution.node";
import { tailscaleApprovalUrl } from "./mobile-access-config";
import type { MobileAccessStatus } from "../src/integrations/mobile-access";

export async function tailscaleExecutable(): Promise<string | undefined> {
  const executable = process.platform === "win32" ? "tailscale.exe" : "tailscale";
  const candidates = [
    ...(process.platform === "win32"
      ? [join(process.env.ProgramFiles ?? "C:\\Program Files", "Tailscale", executable)]
      : [
          "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
          "/usr/local/bin/tailscale",
          "/opt/homebrew/bin/tailscale",
          "/usr/bin/tailscale",
        ]),
    ...(process.env.PATH ?? "")
      .split(delimiter)
      .filter(Boolean)
      .map((directory) => join(directory, executable)),
  ];
  for (const candidate of new Set(candidates)) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* Try the next native binary. */
    }
  }
  return undefined;
}

export async function runTailscale(program: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(program, args, {
    windowsHide: true,
    shell: false,
    encoding: "utf8",
    timeout: 8_000,
    maxBuffer: 512 * 1024,
  });
  return stdout;
}

export function mobileAccessFailure(error: unknown): MobileAccessStatus {
  const details = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const output = `${typeof details.stdout === "string" ? details.stdout : ""}\n${typeof details.stderr === "string" ? details.stderr : ""}`;
  const approvalUrl = tailscaleApprovalUrl(output);
  if (approvalUrl) return { state: "approval-required", approvalUrl };
  if (details.code === "ENOENT") return { state: "install-required" };
  if (
    /access denied|permission denied|not permitted|administrator|sudo|access is denied/i.test(
      output,
    )
  ) {
    return { state: "permission-required" };
  }
  return { state: "unavailable" };
}
