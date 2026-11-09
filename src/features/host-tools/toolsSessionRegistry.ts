import { pathKey } from "../../shared/lib/paths";
import type { BrowserDraftTransfer } from "./browserDraftTransfer";
import type { ConversationTools } from "./SessionHostTools";
import { sameProjectPath } from "../projects/model/recents";

export type ToolsSession = Pick<
  ConversationTools,
  | "cwd"
  | "sessionId"
  | "title"
  | "composerSessionId"
  | "composerWindow"
  | "initialMachine"
  | "initialTab"
  | "onlyTab"
  | "initialUrl"
> & {
  browserDraft?: BrowserDraftTransfer;
  branch?: string;
  worktreeCwd?: string;
  projectName?: string;
  status?: string;
  model?: string;
};
export type ToolsRegistration = ToolsSession & {
  id: string;
  detached?: boolean;
  viewRequest?: ConversationTools["viewRequest"];
};
export type ToolsSourceSnapshot = {
  sourceWindow: string;
  sourceEpoch?: number;
  revision: number;
  selectionRevision: number;
  active: ToolsSession | null;
  panes: ToolsRegistration[];
};

/** Safe cross-window metadata; drafts belong only to explicit transfer envelopes. */
export function toolsSessionMetadata(session: ToolsSession): ToolsSession {
  return {
    cwd: session.cwd,
    sessionId: session.sessionId,
    title: session.title,
    composerSessionId: session.composerSessionId,
    composerWindow: session.composerWindow,
    projectName: session.projectName,
    branch: session.branch,
    worktreeCwd: session.worktreeCwd,
    model: session.model,
    status: session.status,
    onlyTab: session.onlyTab,
    initialMachine: session.initialMachine,
    initialTab: session.initialTab,
  };
}

/** Environment is part of remote cwd; composer shell IDs never identify a Host page. */
export function sameToolsSession(
  a: Pick<ToolsSession, "cwd" | "sessionId"> | null | undefined,
  b: Pick<ToolsSession, "cwd" | "sessionId"> | null | undefined,
) {
  return !!a && !!b && a.sessionId === b.sessionId && sameProjectPath(a.cwd, b.cwd);
}

export function toolsSessionKey(session: Pick<ToolsSession, "cwd" | "sessionId">) {
  return JSON.stringify([pathKey(session.cwd), session.sessionId]);
}

export function toolsProjectName(session: ToolsSession) {
  return (
    session.projectName ||
    session.cwd.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ||
    session.cwd
  );
}

/** Preserve insertion order when statuses update. Reject late source replies. */
export function mergeToolsSource(
  sources: ReadonlyMap<string, ToolsSourceSnapshot>,
  next: ToolsSourceSnapshot,
) {
  const previous = sources.get(next.sourceWindow);
  const epoch = next.sourceEpoch ?? 0;
  const previousEpoch = previous?.sourceEpoch ?? 0;
  if (
    !next.sourceWindow ||
    !Number.isFinite(next.revision) ||
    epoch < previousEpoch ||
    (epoch === previousEpoch && (previous?.revision ?? -1) >= next.revision)
  )
    return sources;
  return new Map(sources).set(next.sourceWindow, next);
}

export function toolsSessionOptions(
  sources: ReadonlyMap<string, ToolsSourceSnapshot>,
  selected?: ToolsSession | null,
) {
  const sessions: ToolsSession[] = [];
  const add = (session: ToolsSession) => {
    if (!sessions.some((item) => sameToolsSession(item, session))) sessions.push(session);
  };
  for (const source of sources.values()) for (const pane of source.panes) add(pane);
  if (selected) add(selected);
  return sessions;
}
