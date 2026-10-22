/** Finite paired-device Jira board contract. Credentials and snapshot ownership stay native. */
export type RemoteJiraScope = { scope: "board" | "backlog" | "sprint"; sprintId?: number };
export type RemoteJiraOperation =
  | { action: "jira-boards"; cwd: string }
  | ({
      action: "jira-board-read";
      cwd: string;
      boardId: number;
      pageToken?: string;
    } & RemoteJiraScope)
  | { action: "jira-issue-transitions"; cwd: string; snapshotId: string; key: string }
  | {
      action: "jira-board-transition";
      cwd: string;
      snapshotId: string;
      key: string;
      transitionId: string;
    }
  | {
      action: "jira-board-move";
      cwd: string;
      snapshotId: string;
      key: string;
      target: "board" | "backlog" | "sprint" | "rank";
      sprintId?: number;
      beforeKey?: string;
      afterKey?: string;
    };
export const jiraBoardActions = [
  "jira-boards",
  "jira-board-read",
  "jira-issue-transitions",
  "jira-board-transition",
  "jira-board-move",
] as const;
export function isRemoteJiraOperation(value: { action: string }): value is RemoteJiraOperation {
  return (jiraBoardActions as readonly string[]).includes(value.action);
}
export function parseRemoteJiraOperation(
  input: Record<string, unknown>,
  cwd: string,
): RemoteJiraOperation {
  const fields: Record<string, string[]> = {
    "jira-boards": [],
    "jira-board-read": ["boardId", "scope", "sprintId", "pageToken"],
    "jira-issue-transitions": ["snapshotId", "key"],
    "jira-board-transition": ["snapshotId", "key", "transitionId"],
    "jira-board-move": ["snapshotId", "key", "target", "sprintId", "beforeKey", "afterKey"],
  };
  const allowed = fields[String(input.action)];
  if (!allowed || Object.keys(input).some((key) => key !== "action" && !allowed.includes(key)))
    throw new Error("Unexpected Jira board request field");
  const positive = (value: unknown) => {
    if (!Number.isSafeInteger(value) || Number(value) < 1)
      throw new Error("Invalid Jira numeric identifier");
    return Number(value);
  };
  const bounded = (value: unknown, max: number) => {
    if (typeof value !== "string" || !value || value.length > max || value.includes("\0"))
      throw new Error("Invalid Jira identifier");
    return value;
  };
  const issue = (value: unknown) => {
    const key = bounded(value, 200);
    if (!/^[A-Z][A-Z0-9_]*-[1-9]\d*$/.test(key)) throw new Error("Invalid Jira issue key");
    return key;
  };
  const action = input.action;
  if (action === "jira-boards") return { action, cwd };
  if (action === "jira-board-read") {
    if (!["board", "backlog", "sprint"].includes(String(input.scope)))
      throw new Error("Invalid Jira board scope");
    const scope = input.scope as RemoteJiraScope["scope"];
    if (scope !== "sprint" && input.sprintId !== undefined)
      throw new Error("A sprint is valid only for sprint scope");
    return {
      action,
      cwd,
      boardId: positive(input.boardId),
      scope,
      ...(scope === "sprint" ? { sprintId: positive(input.sprintId) } : {}),
      ...(input.pageToken === undefined ? {} : { pageToken: bounded(input.pageToken, 4000) }),
    };
  }
  const snapshotId = bounded(input.snapshotId, 100);
  if (!/^[a-f\d-]{36}$/i.test(snapshotId)) throw new Error("Invalid Jira board snapshot");
  const key = issue(input.key);
  if (action === "jira-issue-transitions") return { action, cwd, snapshotId, key };
  if (action === "jira-board-transition") {
    const transitionId = bounded(input.transitionId, 100);
    if (!/^\d+$/.test(transitionId)) throw new Error("Invalid Jira transition");
    return { action, cwd, snapshotId, key, transitionId };
  }
  if (
    action !== "jira-board-move" ||
    !["board", "backlog", "sprint", "rank"].includes(String(input.target))
  )
    throw new Error("Invalid Jira board action");
  const target = input.target as "board" | "backlog" | "sprint" | "rank";
  if (
    (input.beforeKey !== undefined && input.afterKey !== undefined) ||
    (target !== "sprint" && input.sprintId !== undefined)
  )
    throw new Error("Invalid Jira move options");
  const beforeKey = input.beforeKey === undefined ? undefined : issue(input.beforeKey);
  const afterKey = input.afterKey === undefined ? undefined : issue(input.afterKey);
  if (target !== "rank" && (beforeKey || afterKey))
    throw new Error("Review moving and ranking as separate Jira actions");
  if (beforeKey === key || afterKey === key || (target === "rank" && !beforeKey && !afterKey))
    throw new Error("Choose a different displayed Jira rank anchor");
  return {
    action,
    cwd,
    snapshotId,
    key,
    target,
    ...(target === "sprint" ? { sprintId: positive(input.sprintId) } : {}),
    ...(beforeKey ? { beforeKey } : {}),
    ...(afterKey ? { afterKey } : {}),
  };
}
