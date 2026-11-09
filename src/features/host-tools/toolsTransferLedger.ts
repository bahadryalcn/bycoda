import { t } from "../../shared/i18n/technical";
import { pathKey } from "../../shared/lib/paths";
import {
  readBrowserWorkspaceDrafts,
  restoreBrowserWorkspaceDrafts,
  type BrowserWorkspaceDrafts,
} from "./browserDraftTransfer";
import {
  readToolsWorkspaceDrafts,
  restoreToolsWorkspaceDrafts,
  type ToolsWorkspaceDrafts,
} from "./toolsDraftTransfer";
import type { ToolsSession } from "./toolsSessionRegistry";

export type ToolsWorkspaceTransfer = {
  browserDrafts: BrowserWorkspaceDrafts;
  toolsDrafts: ToolsWorkspaceDrafts;
};
function validateSize(value: ToolsWorkspaceTransfer) {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 12 * 1024 * 1024)
    throw new Error(t("Tools draft is too large to transfer. Keep this window open."));
}
export function readWorkspaceTransfer(session: ToolsSession): ToolsWorkspaceTransfer {
  const result = {
    browserDrafts: readBrowserWorkspaceDrafts(session.cwd, session.sessionId),
    toolsDrafts: readToolsWorkspaceDrafts(session.cwd, session.sessionId),
  };
  validateSize(result);
  return result;
}
export function restoreWorkspaceTransfer(session: ToolsSession, value: ToolsWorkspaceTransfer) {
  validateSize(value);
  restoreBrowserWorkspaceDrafts(session.cwd, session.sessionId, value.browserDrafts);
  restoreToolsWorkspaceDrafts(session.cwd, session.sessionId, value.toolsDrafts);
}
export function toolsTransferScope(session: ToolsSession) {
  return JSON.stringify([pathKey(session.cwd), session.sessionId, session.onlyTab ?? "all"]);
}
export function toolsTransferContent(session: ToolsSession, drafts?: ToolsWorkspaceTransfer) {
  return {
    cwd: pathKey(session.cwd),
    sessionId: session.sessionId,
    composerSessionId: session.composerSessionId,
    composerWindow: session.composerWindow,
    onlyTab: session.onlyTab,
    tab: session.onlyTab ?? session.initialTab ?? "devices",
    machine: session.initialMachine ?? "project",
    browserDraft: session.browserDraft,
    drafts,
  };
}

/** Retry conflict detection ignores read-only samples, streamed logs and automatic scroll. */
export function toolsTransferEdits(session: ToolsSession, drafts: ToolsWorkspaceTransfer) {
  return {
    scope: {
      cwd: pathKey(session.cwd),
      sessionId: session.sessionId,
      onlyTab: session.onlyTab,
      tab: session.onlyTab ?? session.initialTab ?? "devices",
      machine: session.initialMachine ?? "project",
    },
    browser: Object.fromEntries(
      Object.entries(drafts.browserDrafts).map(([target, draft]) => [
        target,
        {
          comment: draft.comment,
          annotation: draft.annotation,
          captures: draft.captures,
          current: draft.current,
        },
      ]),
    ),
    tools: Object.fromEntries(
      Object.entries(drafts.toolsDrafts)
        .filter(([, draft]) => !!draft.device || !!draft.servers || !!draft.logs)
        .map(([target, draft]) => [
          target,
          {
            device: draft.device,
            servers: draft.servers
              ? {
                  showStart: draft.servers.showStart,
                  name: draft.servers.name,
                  command: draft.servers.command,
                  workingDirectory: draft.servers.workingDirectory,
                  port: draft.servers.port,
                  restartCommand: draft.servers.restartCommand,
                  restartCwd: draft.servers.restartCwd,
                }
              : undefined,
            logs: draft.logs
              ? {
                  search: draft.logs.search,
                  source: draft.logs.source,
                  sourceIds: draft.logs.sourceIds,
                  level: draft.logs.level,
                  grouped: draft.logs.grouped,
                  follow: draft.logs.follow,
                  paused: draft.logs.paused,
                  monitorUrl: draft.logs.monitorUrl,
                  selected: draft.logs.selected,
                }
              : undefined,
          },
        ]),
    ),
  };
}

export async function toolsTransferFingerprint(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type Receipt<Ack> = { source: string; scope: string; fingerprint: string; ack?: Ack };

/** Receipts contain only operation identity/result, never draft bytes or control grants. */
export class ToolsTransferLedger<Ack> {
  private readonly receipts = new Map<string, Receipt<Ack>>();
  find(requestId: string, source: string, scope: string, fingerprint: string) {
    const receipt = this.receipts.get(requestId);
    if (!receipt) return;
    if (receipt.source !== source || receipt.scope !== scope || receipt.fingerprint !== fingerprint)
      throw new Error(
        t("Tools transfer changed after an uncertain result. Both workspaces retained for review."),
      );
    return receipt;
  }
  begin(requestId: string, source: string, scope: string, fingerprint: string) {
    const previous = this.find(requestId, source, scope, fingerprint);
    if (previous) return previous;
    if ([...this.receipts.values()].filter((receipt) => !receipt.ack).length >= 8)
      throw new Error(t("Too many unresolved tools transfers. Keep the original workspace open."));
    if (this.receipts.size >= 1024)
      throw new Error(
        t("Tools transfer receipt capacity reached. Keep both workspaces open for review."),
      );
    const receipt: Receipt<Ack> = { source, scope, fingerprint };
    this.receipts.set(requestId, receipt);
    return receipt;
  }
  complete(requestId: string, ack: Ack) {
    const receipt = this.receipts.get(requestId);
    if (receipt) receipt.ack = ack;
  }
  abandon(requestId: string) {
    if (!this.receipts.get(requestId)?.ack) this.receipts.delete(requestId);
  }
}

export function toolsTransferError(cause: unknown) {
  return t(cause instanceof Error ? cause.message : String(cause));
}
