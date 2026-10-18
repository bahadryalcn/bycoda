import { invoke } from "@tauri-apps/api/core";
import type { SshEndpoint } from "./serverInventory";
export type SshHttpProxyOperation =
  | {
      kind: "runbook";
      runId: string;
      automationId: string;
      revision: number;
      reviewDigest: string;
      serverId: string;
    }
  | { kind: "terminal"; id: string; shellIntegration?: string }
  | {
      kind: "forward";
      id: string;
      forwardKind: "local" | "dynamic";
      localPort: number;
      targetHost: string;
      targetPort: number;
    }
  | { kind: "sftpList"; operationId: string; path: string }
  | { kind: "sftpDownload"; operationId: string; remotePath: string; localPath: string }
  | {
      kind: "sftpUpload";
      operationId: string;
      localPath: string;
      remotePath: string;
      overwriteConfirmed: boolean;
    }
  | { kind: "sftpResume"; operationId: string; recoveryId: string; overwriteConfirmed: boolean }
  | { kind: "sftpDiscard"; operationId: string; recoveryId: string };
export type SshHttpProxyRequest = {
  connectionId?: string;
  endpoint: SshEndpoint;
  operation: SshHttpProxyOperation;
};
export type SshHttpProxyApproval = { ticketId: string; expiresInSeconds: number };
export function validHttpProxyCredentials(username: string, password: string) {
  const bytes = (value: string) => new TextEncoder().encode(value).length;
  const controls = (value: string) =>
    [...value].some((char) => {
      const code = char.codePointAt(0)!;
      return code < 32 || (code >= 127 && code <= 159);
    });
  return (
    !!username &&
    !username.includes(":") &&
    bytes(username) <= 4096 &&
    bytes(password) <= 4096 &&
    !controls(username) &&
    !controls(password)
  );
}
/** A one-operation native lease only. Credentials never enter a connection record. */
export async function approveSshHttpProxy(
  request: SshHttpProxyRequest,
  username: string,
  password: string,
  allowPlainHttp: boolean,
): Promise<SshHttpProxyApproval> {
  const result = await invoke<SshHttpProxyApproval>("ssh_http_proxy_credentials_approve", {
    ...(request.connectionId
      ? { connectionId: request.connectionId }
      : { endpoint: request.endpoint }),
    expectedEndpoint: request.endpoint,
    operation: request.operation,
    username,
    password,
    allowPlainHttp,
  });
  if (
    !result ||
    typeof result.ticketId !== "string" ||
    !result.ticketId ||
    result.ticketId.length > 200 ||
    !Number.isInteger(result.expiresInSeconds) ||
    result.expiresInSeconds < 1 ||
    result.expiresInSeconds > (request.operation.kind === "runbook" ? 120 : 30)
  )
    throw new Error("Invalid HTTP proxy approval");
  return result;
}

/** Revoke only an unused window-owned lease; never retries authentication. */
export const revokeSshHttpProxyApproval = (ticketId: string) =>
  invoke<void>("ssh_http_proxy_credentials_revoke", { ticketId });
