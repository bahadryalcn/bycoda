import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type SftpEntry = { name: string; kind: "file" | "directory" | "symlink" };

/** Literal names only: OpenSSH's batch language still expands glob syntax. */
export function sftpPath(parent: string, name: string): string {
  // oxlint-disable-next-line no-control-regex -- remote batch injection prevention
  if (!name || name === "." || name === ".." || /[\x00-\x1f\x7f*?[\]{}\\/]/u.test(name)) {
    throw new Error("Unsupported SFTP filename");
  }
  return `${parent.replace(/\/$/, "")}/${name}`;
}

export function sftpParent(path: string): string {
  if (path === ".") return "..";
  if (path === "/") return "/";
  const trimmed = path.replace(/\/$/, "");
  if (/(^|\/)\.\.$/.test(trimmed)) return `${trimmed}/..`;
  if (!trimmed.includes("/")) return ".";
  return trimmed.replace(/\/[^/]+$/, "") || "/";
}

export const listSftp = (
  connectionId: string,
  path: string,
  operationId: string,
  httpProxyTicketId?: string,
) =>
  invoke<SftpEntry[]>("ssh_sftp_list", {
    connectionId,
    path,
    operationId,
    ...(httpProxyTicketId ? { httpProxyTicketId } : {}),
  });
export const downloadSftp = (
  connectionId: string,
  remotePath: string,
  localPath: string,
  operationId: string,
  httpProxyTicketId?: string,
) =>
  invoke<void>("ssh_sftp_download", {
    connectionId,
    remotePath,
    localPath,
    operationId,
    ...(httpProxyTicketId ? { httpProxyTicketId } : {}),
  });
export const uploadSftp = (
  connectionId: string,
  localPath: string,
  remotePath: string,
  overwriteConfirmed: boolean,
  operationId: string,
  httpProxyTicketId?: string,
) =>
  invoke<number>("ssh_sftp_upload", {
    connectionId,
    localPath,
    remotePath,
    overwriteConfirmed,
    operationId,
    ...(httpProxyTicketId ? { httpProxyTicketId } : {}),
  });
export const cancelSftp = (operationId: string) => invoke<void>("ssh_sftp_cancel", { operationId });

export type SftpProgress = {
  operationId: string;
  phase: string;
  transferredBytes: number;
  totalBytes?: number;
  state: "running" | "transferred" | "completed" | "cancelled" | "failed";
};
export type SftpRecovery = {
  id: string;
  direction: "upload" | "download";
  localPath: string;
  remotePath: string;
  partialBytes: number;
  totalBytes?: number;
  publication?: "unknown" | "completed";
};
export function validSftpProgress(value: unknown): value is SftpProgress {
  if (!value || typeof value !== "object") return false;
  const event = value as SftpProgress;
  return (
    typeof event.operationId === "string" &&
    typeof event.phase === "string" &&
    event.phase.length <= 100 &&
    Number.isSafeInteger(event.transferredBytes) &&
    event.transferredBytes >= 0 &&
    (event.totalBytes == null ||
      (Number.isSafeInteger(event.totalBytes) && event.totalBytes >= event.transferredBytes)) &&
    ["running", "transferred", "completed", "cancelled", "failed"].includes(event.state)
  );
}
export const subscribeSftpProgress = (callback: (event: SftpProgress) => void) =>
  listen<unknown>("ssh-sftp-progress", (event) => {
    if (validSftpProgress(event.payload)) callback(event.payload);
  });
export async function loadSftpRecoveries(connectionId: string): Promise<SftpRecovery[]> {
  const records = await invoke<SftpRecovery[]>("ssh_sftp_recoveries", { connectionId });
  return Array.isArray(records) ? records : [];
}
export const resumeSftp = (
  connectionId: string,
  recoveryId: string,
  overwriteConfirmed: boolean,
  operationId: string,
  httpProxyTicketId?: string,
) =>
  invoke<void>("ssh_sftp_resume", {
    connectionId,
    recoveryId,
    overwriteConfirmed,
    operationId,
    ...(httpProxyTicketId ? { httpProxyTicketId } : {}),
  });
export const discardSftp = (
  connectionId: string,
  recoveryId: string,
  operationId: string,
  httpProxyTicketId?: string,
) =>
  invoke<void>("ssh_sftp_discard", {
    connectionId,
    recoveryId,
    operationId,
    ...(httpProxyTicketId ? { httpProxyTicketId } : {}),
  });
