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
