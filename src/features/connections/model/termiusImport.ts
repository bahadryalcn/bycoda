import { t } from "../../../shared/i18n";
import type { ServerRecord, SshEndpoint } from "./serverInventory";

export type TermiusHost = {
  sourceId: string;
  name: string;
  endpoint: SshEndpoint;
  group?: string | null;
  tags: string[];
  hasKey: boolean;
  needsPassword: boolean;
  requiresReview: boolean;
  warnings: string[];
};
export type TermiusPreview = { ticket: string; hosts: TermiusHost[]; warnings: string[] };
export type TermiusOutcome = { imported: number; skipped: number; keys: number };

/** The desktop's own English sentences about a Termius scan, translated when this build knows
 * them; any other text is shown as the desktop sent it. */
export function termiusText(message: string): string {
  switch (message) {
    case "Proxy settings require review":
      return t("Proxy settings require review");
    case "Host chain requires review":
      return t("Host chain requires review");
    case "Agent forwarding is not imported":
      return t("Agent forwarding is not imported");
    case "Enter the server password when connecting":
      return t("Enter the server password when connecting");
    case "Saved passwords, port forwards and snippets are not imported.":
      return t("Saved passwords, port forwards and snippets are not imported.");
    case "Migration preview expired. Scan Termius again.":
      return t("Migration preview expired. Scan Termius again.");
    case "No Termius hosts found in this profile":
      return t("No Termius hosts found in this profile");
    case "Termius data changed after preview. Scan Termius again.":
      return t("Termius data changed after preview. Scan Termius again.");
    case "Termius data changed while reading. Close Termius and try again.":
      return t("Termius data changed while reading. Close Termius and try again.");
    case "Termius stores this record in an external file that this importer cannot read. No records were imported.":
      return t(
        "Termius stores this record in an external file that this importer cannot read. No records were imported.",
      );
    default:
      return message;
  }
}

export function termiusDuplicate(host: TermiusHost, servers: ServerRecord[]) {
  return servers.some((server) => {
    let endpoint = server.effectiveSshEndpoint ?? server.sshEndpoint;
    if (!endpoint && server.machine?.ssh) {
      const ssh = server.machine.ssh;
      const index = ssh.target.lastIndexOf("@");
      endpoint = {
        host: index >= 0 ? ssh.target.slice(index + 1) : ssh.target,
        user: index >= 0 ? ssh.target.slice(0, index) : undefined,
        port: ssh.port ?? 22,
      };
    }
    return (
      endpoint?.host.toLowerCase() === host.endpoint.host.toLowerCase() &&
      (endpoint.user || undefined) === (host.endpoint.user || undefined) &&
      endpoint.port === host.endpoint.port
    );
  });
}

export const termiusNeedsReview = (host: TermiusHost) => host.requiresReview;
