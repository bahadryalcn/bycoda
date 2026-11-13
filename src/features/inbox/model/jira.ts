import { invoke } from "@tauri-apps/api/core";
import { boundedSet } from "../../../shared/lib/store";
import { recordInboxSelfActivity } from "./inboxSelfActivity";
import { jiraCommentDocument, type JiraCommentImage } from "./jiraCommentDocument";

export type JiraProject = {
  id: string;
  key: string;
  name: string;
};

export type JiraIssue = {
  /** Client-side context for board-specific working folder defaults. */
  jiraBoardId?: number;
  provider: "jira";
  kind: "jira";
  id: string;
  identifier: string;
  number: number;
  title: string;
  url: string;
  state: string;
  /** Jira status category: `new`, `indeterminate` or `done`. */
  stateType: string;
  updatedAt: string;
  labels: { name: string; color: string }[];
  assignees: { login: string; accountId?: string; avatarUrl?: string }[];
  draft: boolean;
  repo: string;
  teamId: string;
  teamName: string;
  projectPath: string;
};

export type JiraIssueDetails = {
  body: string;
  author: string;
  authorAvatarUrl?: string;
};

export type JiraIssueComment = {
  id: string;
  kind: string;
  author: string;
  authorAvatarUrl?: string;
  body: string;
  createdAt: string;
  url: string;
  state: string;
  path: string;
  line: number | null;
  resolved: boolean;
  threadId: string;
  replies: JiraIssueComment[];
};

export type JiraIssueThread = {
  comments: JiraIssueComment[];
  truncated: boolean;
  reviewDecision: string;
  baseRefName: string;
  headRefName: string;
};

export type JiraStatus = {
  connected: boolean;
  site: string;
  email: string;
};

const PROJECT_IDS_KEY = "bycoda.jiraHiddenProjects";
export const JIRA_CHANGE_EVENT = "bycoda:jira-change";

export function jiraBackgroundSyncEnabled(): boolean {
  return localStorage.getItem("bycoda.jiraBackgroundSync") === "true";
}

export function saveJiraBackgroundSync(enabled: boolean) {
  localStorage.setItem("bycoda.jiraBackgroundSync", String(enabled));
  notifyJiraChange();
}

export function loadAllowedJiraBoardIds(): number[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem("bycoda.jiraAllowedBoards") ?? "[]");
    return Array.isArray(value)
      ? value.filter((id): id is number => Number.isSafeInteger(id) && id > 0)
      : [];
  } catch {
    return [];
  }
}

export function saveAllowedJiraBoardIds(ids: number[]) {
  localStorage.setItem("bycoda.jiraAllowedBoards", JSON.stringify(ids));
  notifyJiraChange();
}

// Keyed by issue key (ENG-42): the REST paths and browse URLs both take it.
const detailsByKey = new Map<string, JiraIssueDetails>();
const threadByKey = new Map<string, JiraIssueThread>();
const threadInflight = new Map<string, Promise<JiraIssueThread>>();
// Keep discovered filter choices when a narrowed result no longer contains them.
const knownFilterIssues = new Map<string, JiraIssue>();

export function knownJiraFilterIssues(): JiraIssue[] {
  return [...knownFilterIssues.values()];
}

let cacheGeneration = 0;
export function jiraReadGeneration() {
  return cacheGeneration;
}

export function clearJiraCache() {
  cacheGeneration += 1;
  detailsByKey.clear();
  threadByKey.clear();
  threadInflight.clear();
  knownFilterIssues.clear();
}

export function jiraConnected(): Promise<JiraStatus> {
  return invoke<JiraStatus>("jira_status");
}

export async function saveJiraConfig(config: {
  site: string;
  email: string;
  token: string;
}): Promise<JiraStatus> {
  const status = await invoke<JiraStatus>("jira_set_config", {
    site: config.site.trim(),
    email: config.email.trim(),
    token: config.token.trim(),
  });
  clearJiraCache();
  return status;
}

export async function disconnectJira(): Promise<JiraStatus> {
  const status = await invoke<JiraStatus>("jira_set_config", {
    site: "",
    email: "",
    token: "",
  });
  clearJiraCache();
  return status;
}

export function listJiraProjects(): Promise<JiraProject[]> {
  return invoke<JiraProject[]>("jira_list_projects");
}

/** `null` means do not filter by project. `[]` means every known project is hidden. */
export function jiraProjectIdsForFetch(
  projects: readonly JiraProject[],
  hiddenIds: readonly string[],
): string[] | null {
  if (hiddenIds.length === 0) return null;
  const hidden = new Set(hiddenIds);
  const visible = projects
    .filter((project) => !hidden.has(project.id))
    .map((project) => project.id);
  if (visible.length === projects.length) return null;
  return visible;
}

export async function listJiraIssues(query: {
  assignedToMe: boolean;
  assigneeIds?: string[];
  unassigned?: boolean;
  statuses?: string[];
  state: "open" | "all";
  projectIds: string[];
  limit?: number;
}): Promise<JiraIssue[]> {
  const generation = cacheGeneration;
  const issues = await invoke<JiraIssue[]>("jira_list_issues", {
    assignedToMe: query.assignedToMe,
    state: query.state,
    projectIds: query.projectIds,
    limit: query.limit,
    ...(query.assigneeIds?.length || query.unassigned || query.statuses?.length
      ? {
          filters: {
            assigneeIds: query.assigneeIds ?? [],
            unassigned: query.unassigned ?? false,
            statuses: query.statuses ?? [],
          },
        }
      : {}),
  });
  if (generation === cacheGeneration) {
    for (const issue of issues) boundedSet(knownFilterIssues, issue.id, issue, 512);
  }
  return issues;
}

/** Cursor reads feed the same bounded filter catalog as legacy reads. */
export function rememberJiraFilterIssues(issues: readonly JiraIssue[]) {
  for (const issue of issues) boundedSet(knownFilterIssues, issue.id, issue, 512);
}

/** Detail payloads are bounded LRU entries: get refreshes recency, set evicts the oldest past the cap. */
const DETAILS_CACHE_LIMIT = 128;
function boundedGet<T>(cache: Map<string, T>, key: string): T | null {
  if (!cache.has(key)) return null;
  const value = cache.get(key)!;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

export function peekJiraIssueDetails(key: string): JiraIssueDetails | null {
  return boundedGet(detailsByKey, key);
}

export async function jiraIssueDetails(key: string): Promise<JiraIssueDetails> {
  const generation = cacheGeneration;
  const details = await invoke<JiraIssueDetails>("jira_issue_details", {
    key,
  });
  if (generation === cacheGeneration) boundedSet(detailsByKey, key, details, DETAILS_CACHE_LIMIT);
  return details;
}

export function peekJiraIssueThread(key: string): JiraIssueThread | null {
  return threadByKey.get(key) ?? null;
}

export async function jiraIssueThread(
  key: string,
  options?: { force?: boolean },
): Promise<JiraIssueThread> {
  if (options?.force) {
    threadByKey.delete(key);
    threadInflight.delete(key);
  }
  const pending = threadInflight.get(key);
  if (pending) return pending;
  const generation = cacheGeneration;
  const promise = invoke<JiraIssueThread>("jira_issue_thread", { key })
    .then((thread) => {
      if (generation === cacheGeneration && threadInflight.get(key) === promise) {
        threadByKey.set(key, thread);
      }
      return thread;
    })
    .finally(() => {
      if (threadInflight.get(key) === promise) threadInflight.delete(key);
    });
  threadInflight.set(key, promise);
  return promise;
}

export async function jiraIssueComment(
  issue: { id: string; key: string },
  body: string,
  images?: JiraCommentImage[],
): Promise<string> {
  for (const image of images ?? []) {
    if (image.uploaded?.key === issue.key) continue;
    const uploaded = await invoke<{ id: string; url: string }>("jira_issue_attachment", {
      key: issue.key,
      name: image.name,
      mimeType: image.type,
      dataBase64: image.dataUrl.slice(image.dataUrl.indexOf(",") + 1),
    });
    // Receipt belongs to the retained image draft. Keep successful uploads if
    // another upload or the comment fails, including across composer remounts.
    image.uploaded = { ...uploaded, key: issue.key };
  }
  const url = await invoke<string>("jira_issue_comment", {
    key: issue.key,
    body: body.trim(),
    ...(images ? { document: jiraCommentDocument(body.trim(), images) } : {}),
  });
  threadByKey.delete(issue.key);
  threadInflight.delete(issue.key);
  recordInboxSelfActivity({ provider: "jira", kind: "jira", id: issue.id });
  return url;
}

/** Distinguishes an empty saved scope from one that cannot be read: `null` means
 * unreadable or corrupt, and callers must not treat it as "hide nothing". */
export function readHiddenJiraProjectIds(): string[] | null {
  try {
    const raw = localStorage.getItem(PROJECT_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return null;
  }
}

/** Display fallback only; fetch paths use `requireHiddenJiraProjectIds`. */
export function loadHiddenJiraProjectIds(): string[] {
  return readHiddenJiraProjectIds() ?? [];
}

/** Fails closed so an unreadable saved scope never widens what Jira fetches. */
export function requireHiddenJiraProjectIds(): string[] {
  const ids = readHiddenJiraProjectIds();
  if (!ids) throw new Error("Saved Jira project scope is unavailable, so Jira results are paused.");
  return ids;
}

/** Returns whether the new scope was read back from storage. */
export function saveHiddenJiraProjectIds(ids: string[]): boolean {
  let persisted = false;
  try {
    localStorage.setItem(PROJECT_IDS_KEY, JSON.stringify(ids));
    const stored = readHiddenJiraProjectIds();
    persisted = !!stored && stored.length === ids.length && ids.every((id) => stored.includes(id));
  } catch {
    // private mode / quota
  }
  notifyJiraChange();
  return persisted;
}

/** Same-window changes and sibling-window storage changes to Jira scope. */
export function subscribeJiraScope(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea && event.storageArea !== localStorage) return;
    if (
      event.key === null ||
      event.key === PROJECT_IDS_KEY ||
      event.key === "bycoda.jiraAllowedBoards" ||
      event.key === "bycoda.jiraBackgroundSync"
    )
      onChange();
  };
  window.addEventListener(JIRA_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(JIRA_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function notifyJiraChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(JIRA_CHANGE_EVENT));
}
