import { IS_WIN } from "../../../platform/tauri/platform";
import type { SshJumpPolicy } from "./serverInventory";
import { MAX_SSH_JUMP_HOSTS, validSshEndpointPreview } from "./sshEndpointReview";

/** Form strings stay intact while editing. No file access, defaults lookup or transport. */
export type SshJumpPolicyDraft = {
  host: string;
  user: string;
  port: string;
  identityFile: string;
  certificateFile: string;
  knownHostsFile: string;
};
export const emptySshJumpPolicyDraft = (): SshJumpPolicyDraft => ({
  host: "",
  user: "",
  port: "22",
  identityFile: "",
  certificateFile: "",
  knownHostsFile: "",
});
export function sshJumpPolicyDrafts(policies: readonly SshJumpPolicy[]): SshJumpPolicyDraft[] {
  return policies.map((hop) => ({
    host: hop.host,
    user: hop.user ?? "",
    port: String(hop.port),
    identityFile: hop.identityFile ?? "",
    certificateFile: hop.certificateFile ?? "",
    knownHostsFile: hop.knownHostsFile ?? "",
  }));
}
export function validSshJumpFileReference(
  value: string,
  platform: "windows" | "posix" = IS_WIN ? "windows" : "posix",
): boolean {
  if (!value) return true;
  // oxlint-disable-next-line no-control-regex -- mirrors native control/expansion restrictions for literal file references
  if (new TextEncoder().encode(value).length > 4096 || /[\x00-\x1f\x7f-\x9f%$"]/.test(value))
    return false;
  if (value.startsWith("~/") || value.startsWith("~\\")) return true;
  return platform === "windows"
    ? /^[a-zA-Z]:[\\/]/.test(value) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+/.test(value)
    : value.startsWith("/");
}

/** Friendly preflight only. Native host/key-reference validation remains authoritative. */
export function sshJumpPoliciesFromDrafts(
  drafts: readonly SshJumpPolicyDraft[],
  platform: "windows" | "posix" = IS_WIN ? "windows" : "posix",
): SshJumpPolicy[] | undefined {
  if (drafts.length > MAX_SSH_JUMP_HOSTS) return undefined;
  const policies: SshJumpPolicy[] = [];
  for (const draft of drafts) {
    if (!/^\d+$/.test(draft.port)) return undefined;
    const hop: SshJumpPolicy = {
      host: draft.host.trim(),
      port: Number(draft.port),
      ...(draft.user.trim() ? { user: draft.user.trim() } : {}),
      ...(draft.identityFile ? { identityFile: draft.identityFile } : {}),
      ...(draft.certificateFile ? { certificateFile: draft.certificateFile } : {}),
      ...(draft.knownHostsFile ? { knownHostsFile: draft.knownHostsFile } : {}),
    };
    if (!validSshEndpointPreview(hop)) return undefined;
    for (const reference of [draft.identityFile, draft.certificateFile, draft.knownHostsFile]) {
      if (!validSshJumpFileReference(reference, platform)) return undefined;
    }
    policies.push(hop);
  }
  return policies;
}
