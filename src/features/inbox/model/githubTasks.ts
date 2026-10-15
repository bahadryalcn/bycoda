import { relativeTimeFormat } from "../../../shared/lib/intl";
import { invoke } from "@tauri-apps/api/core";
import { githubRead } from "./githubReadGate";
import { clearKnownInboxItems } from "./inboxSeen";
import {
  linearConnected,
  linearTeamIdsForFetch,
  listLinearIssues,
  listLinearTeams,
  loadHiddenLinearTeamIds,
  type LinearIssue,
} from "./linear";
import {
  clearJiraCache,
  jiraConnected,
  jiraProjectIdsForFetch,
  listJiraIssues,
  listJiraProjects,
  loadHiddenJiraProjectIds,
  type JiraIssue,
} from "./jira";
import {
  clearGitlabCache,
  gitlabConnected,
  gitlabRepo,
  listGitlabTodos,
  listGitlabWorkItems,
  type GitlabWorkItem,
} from "./gitlab";
import {
  azureDevOpsConnected,
  azureDevOpsRepo,
  clearAzureDevOpsCache,
  listAzureDevOpsTodos,
  listAzureDevOpsWorkItems,
  type AzureDevOpsWorkItem,
} from "./azureDevOps";
import {
  collectRailProjects,
  normalizeProjectPath,
  sameProjectPath,
  type RecentProject,
} from "../../projects/model/recents";
import { recordInboxSelfActivity } from "./inboxSelfActivity";

export type GithubTaskKind = "issue" | "pr";
export type GithubPrAction = "merge" | "squash" | "rebase" | "draft" | "ready" | "close" | "reopen";
export type InboxKind = GithubTaskKind | "linear" | "jira";

export type GithubLabel = {
  name: string;
  color: string;
};

export type GithubAssignee = {
  login: string;
  avatarUrl?: string;
};

export type GithubWorkItem = {
  kind: GithubTaskKind;
  number: number;
  title: string;
  url: string;
  state: string;
  /** GitHub issue closure reason, such as `completed` or `not_planned`. */
  stateReason?: string;
  createdAt?: string;
  updatedAt: string;
  labels: GithubLabel[];
  assignees: GithubAssignee[];
  draft: boolean;
  repo: string;
};

export type InboxProvider = "github" | "linear" | "jira" | "gitlab" | "azuredevops";

export type InboxItem = Omit<GithubWorkItem, "kind"> & {
  kind: InboxKind;
  projectPath: string;
  provider: InboxProvider;
  id?: string;
  identifier?: string;
  teamId?: string;
  teamName?: string;
  /** Linear project the issue belongs to. Empty when it sits outside every project. */
  projectId?: string;
  projectName?: string;
  stateType?: string;
  /** GitLab To-Do action that caused this item to need attention. */
  attentionReason?: string;
};

export type GithubWorkItemDetails = {
  body: string;
  author: string;
  authorAvatarUrl?: string;
  baseRefName?: string;
  headRefName?: string;
  reviewDecision?: string;
};

export type GithubWorkItemComment = {
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
  replies: GithubWorkItemComment[];
};

export type GithubWorkItemCommit = {
  oid: string;
  messageHeadline: string;
  author: string;
  committedDate: string;
  url: string;
};

export type GithubWorkItemThread = {
  comments: GithubWorkItemComment[];
  commits: GithubWorkItemCommit[];
  truncated: boolean;
  reviewDecision: string;
  baseRefName: string;
  headRefName: string;
};

export type GithubPrFile = {
  path: string;
  additions: number;
  deletions: number;
};

export type GithubPrDiff = {
  additions: number;
  deletions: number;
  files: GithubPrFile[];
  patch: string;
  truncated: boolean;
};

export type GithubWorkItemQuery = {
  kind: GithubTaskKind;
  assignedToMe: boolean;
  state: "open" | "all";
  search: string;
};

export type InboxQuery = Omit<GithubWorkItemQuery, "kind"> & {
  githubKinds?: GithubTaskKind[];
  linearHiddenTeamIds?: string[];
  jiraHiddenProjectIds?: string[];
  /** Background callers explicitly opt out of Jira network reads. */
  jiraEnabled?: boolean;
};

export type InboxProviderErrors = Partial<Record<InboxProvider, string>>;

export type GithubStatus = {
  connected: boolean;
  installed: boolean;
  authenticated: boolean;
};

export type GithubStarStatus = "starred" | "notStarred" | "unavailable";

export type InboxListResult = {
  items: InboxItem[];
  errors: InboxProviderErrors;
};

const INBOX_CACHE_FRESH_MS = 120_000;

/** Closed history competes for the same slots, so an unfiltered fetch needs the wider page. */
const INBOX_ALL_LIMIT = 100;

/** Repo lookups and list calls of one provider that run at once. */
export const INBOX_PROVIDER_CONCURRENCY = 4;

/** `Promise.allSettled` over lazily started tasks, at most `limit` running at
 * once; results keep the task order. */
export async function settleWithLimit<T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number = INBOX_PROVIDER_CONCURRENCY,
): Promise<PromiseSettledResult<T>[]> {
  const results = new Array<PromiseSettledResult<T>>(tasks.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await tasks[index]!() };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), tasks.length) }, worker));
  return results;
}

type InboxListCache = InboxListResult & {
  key: string;
  fetchedAt: number;
};

const inboxListCaches = new Map<string, InboxListCache>();
let inboxCacheGeneration = 0;
const inboxListInflight = new Map<string, Promise<InboxListResult>>();
const githubLists = new Map<string, { items: GithubWorkItem[]; at: number }>();
const githubListsInflight = new Map<string, Promise<GithubWorkItem[]>>();
const repoByPath = new Map<string, string>();
const repositoriesByPath = new Map<string, string[]>();
const workItemByKey = new Map<string, GithubWorkItem>();
const workItemInflight = new Map<string, Promise<GithubWorkItem>>();
const detailsByKey = new Map<string, GithubWorkItemDetails>();
const detailsInflight = new Map<string, Promise<GithubWorkItemDetails>>();
const threadByKey = new Map<string, GithubWorkItemThread>();
const threadInflight = new Map<string, Promise<GithubWorkItemThread>>();
const prDiffByKey = new Map<string, GithubPrDiff>();
const prDiffInflight = new Map<string, Promise<GithubPrDiff>>();

export const GITHUB_WORK_ITEM_FRESH_MS = INBOX_CACHE_FRESH_MS;
const itemScopes = new Map<string, { scope: string }>();
function ensureItemScope(cwd: string, repo: string, kind: GithubTaskKind, number: number) {
  const key = detailsCacheKey(repo, kind, number);
  const scope = normalizeProjectPath(cwd);
  // An evicted scope is unknown too; never reuse data whose owner is lost.
  const hasDiff = [false, true].some((fullContext) => {
    const diffKey = prDiffCacheKey(repo, number, fullContext);
    return prDiffByKey.has(diffKey) || prDiffInflight.has(diffKey);
  });
  const owner = itemScopes.get(key);
  if (
    owner?.scope !== scope &&
    (itemScopes.has(key) ||
      workItemByKey.has(key) ||
      detailsByKey.has(key) ||
      threadByKey.has(key) ||
      workItemInflight.has(key) ||
      detailsInflight.has(key) ||
      threadInflight.has(key) ||
      hasDiff)
  )
    invalidateGithubWorkItem(repo, kind, number);
  itemScopes.delete(key);
  itemScopes.set(key, owner?.scope === scope ? owner : { scope });
  while (itemScopes.size > 128) itemScopes.delete(itemScopes.keys().next().value!);
}
function scopeMatches(key: string, cwd?: string) {
  return cwd == null || itemScopes.get(key)?.scope === normalizeProjectPath(cwd);
}
const fetchedAt = new Map<string, number>();
const ITEM_CACHE_LIMIT = 128;
function freshEnough(key: string, maxAgeMs?: number) {
  const at = fetchedAt.get(key);
  return maxAgeMs != null && at != null && Date.now() - at < maxAgeMs;
}
function remember<T>(cache: Map<string, T>, key: string, value: T, namespace: string) {
  cache.delete(key);
  cache.set(key, value);
  fetchedAt.set(`${namespace}:${key}`, Date.now());
  while (cache.size > ITEM_CACHE_LIMIT) {
    const oldest = cache.keys().next().value!;
    cache.delete(oldest);
    fetchedAt.delete(`${namespace}:${oldest}`);
  }
}
function invalidateGithubWorkItem(repo: string, kind: GithubTaskKind, number: number) {
  const key = detailsCacheKey(repo, kind, number);
  workItemByKey.delete(key);
  workItemInflight.delete(key);
  fetchedAt.delete(`item:${key}`);
  detailsByKey.delete(key);
  detailsInflight.delete(key);
  threadByKey.delete(key);
  threadInflight.delete(key);
  fetchedAt.delete(`details:${key}`);
  fetchedAt.delete(`thread:${key}`);
  for (const full of [false, true]) {
    const diffKey = prDiffCacheKey(repo, number, full);
    prDiffByKey.delete(diffKey);
    prDiffInflight.delete(diffKey);
    fetchedAt.delete(`diff:${diffKey}`);
  }
}

export function clearInboxCache() {
  inboxCacheGeneration += 1;
  clearJiraCache();
  clearKnownInboxItems();
  inboxListCaches.clear();
  inboxListInflight.clear();
  githubLists.clear();
  githubListsInflight.clear();
  repoByPath.clear();
  repositoriesByPath.clear();
  workItemByKey.clear();
  workItemInflight.clear();
  detailsByKey.clear();
  detailsInflight.clear();
  fetchedAt.clear();
  itemScopes.clear();
  threadByKey.clear();
  threadInflight.clear();
  prDiffByKey.clear();
  prDiffInflight.clear();
  clearGitlabCache();
  clearAzureDevOpsCache();
}

export function inboxListCacheKey(
  projects: readonly { path: string }[],
  query: InboxQuery,
): string {
  const paths = uniqueInboxProjects(projects)
    .map((project) => normalizeProjectPath(project.path))
    .sort()
    .join("|");
  const teams = [...(query.linearHiddenTeamIds ?? [])].sort().join(",");
  const jiraProjects = [...(query.jiraHiddenProjectIds ?? [])].sort().join(",");
  return `${query.assignedToMe ? 1 : 0}:${query.state}:${paths}:${teams}:${jiraProjects}:${query.search.trim()}:${[...(query.githubKinds ?? ["issue", "pr"])].sort().join(",")}:${query.jiraEnabled === false ? "no-jira" : "jira"}`;
}

export function peekInboxList(
  projects: readonly { path: string }[],
  query: InboxQuery,
): InboxListResult | null {
  const key = inboxListCacheKey(projects, query);
  const inboxListCache = inboxListCaches.get(key);
  if (!inboxListCache) return null;
  return { items: inboxListCache.items, errors: inboxListCache.errors };
}

export function peekInboxItems(
  projects: readonly { path: string }[],
  query: InboxQuery,
): InboxItem[] | null {
  return peekInboxList(projects, query)?.items ?? null;
}

export function inboxListIsFresh(
  projects: readonly { path: string }[],
  query: InboxQuery,
  now = Date.now(),
): boolean {
  const key = inboxListCacheKey(projects, query);
  const inboxListCache = inboxListCaches.get(key);
  return inboxListCache != null && now - inboxListCache.fetchedAt < INBOX_CACHE_FRESH_MS;
}

export function githubStatus(): Promise<GithubStatus> {
  return invoke<GithubStatus>("git_github_status");
}

/** Whether the active GitHub CLI account has starred Bycoda. */
export function githubBycodaStarStatus(): Promise<GithubStarStatus> {
  return invoke<GithubStarStatus>("github_bycoda_star_status");
}

/** Star Bycoda for the active GitHub CLI account. */
export function starBycodaOnGithub(): Promise<void> {
  return invoke<void>("github_star_bycoda");
}

export async function githubRepo(cwd: string): Promise<string> {
  const key = normalizeProjectPath(cwd);
  const cached = repoByPath.get(key);
  if (cached !== undefined) return cached;
  const repositories = repositoriesByPath.get(key);
  if (repositories?.[0]) return repositories[0];
  const repo = await githubRead<string>("git_github_repo", { cwd });
  repoByPath.set(key, repo);
  return repo;
}

export async function githubRepositories(cwd: string): Promise<string[]> {
  const key = normalizeProjectPath(cwd);
  const cached = repositoriesByPath.get(key);
  if (cached) return cached;
  const repositories = await githubRead<string[]>("git_github_repositories", {
    cwd,
  });
  if (repositories.length === 0) {
    throw new Error("GitHub did not return a repository");
  }
  repositoriesByPath.set(key, repositories);
  repoByPath.set(key, repositories[0]!);
  return repositories;
}

export function listGithubWorkItems(
  cwd: string,
  repo: string,
  query: GithubWorkItemQuery,
  options?: { force?: boolean },
): Promise<GithubWorkItem[]> {
  const key = JSON.stringify([
    normalizeProjectPath(cwd),
    repo.trim().toLowerCase(),
    query.kind,
    query.assignedToMe,
    query.state,
    query.search.trim(),
  ]);
  const cached = githubLists.get(key);
  if (!options?.force && cached && Date.now() - cached.at < INBOX_CACHE_FRESH_MS)
    return Promise.resolve(cached.items);
  const pending = githubListsInflight.get(key);
  if (pending) return pending;
  const generation = inboxCacheGeneration;
  const promise = githubRead<GithubWorkItem[]>("git_github_work_items", {
    cwd,
    repo,
    kind: query.kind,
    assignedToMe: query.assignedToMe,
    state: query.state,
    search: query.search.trim(),
    limit: query.state === "all" ? INBOX_ALL_LIMIT : undefined,
  })
    .then((items) => {
      if (generation === inboxCacheGeneration) {
        githubLists.delete(key);
        githubLists.set(key, { items, at: Date.now() });
        while (githubLists.size > 128) githubLists.delete(githubLists.keys().next().value!);
      }
      return items;
    })
    .finally(() => {
      if (githubListsInflight.get(key) === promise) githubListsInflight.delete(key);
    });
  githubListsInflight.set(key, promise);
  return promise;
}

function workItemLookupKey(repo: string, kind: GithubTaskKind, number: number): string {
  return `${repo.trim().toLowerCase()}:${kind}:${number}`;
}

export function peekGithubWorkItem(
  repo: string,
  kind: GithubTaskKind,
  number: number,
  cwd?: string,
): GithubWorkItem | null {
  if (!scopeMatches(workItemLookupKey(repo, kind, number), cwd)) return null;
  return workItemByKey.get(workItemLookupKey(repo, kind, number)) ?? null;
}

/** Fetch one exact item after targeted Inbox navigation misses its list cache. */
export function githubWorkItem(
  cwd: string,
  repo: string,
  kind: GithubTaskKind,
  number: number,
  options?: { force?: boolean; maxAgeMs?: number },
): Promise<GithubWorkItem> {
  ensureItemScope(cwd, repo, kind, number);
  const generation = inboxCacheGeneration;
  const key = workItemLookupKey(repo, kind, number);
  const cached = workItemByKey.get(key);
  if (
    cached &&
    !options?.force &&
    (options?.maxAgeMs == null || freshEnough(`item:${key}`, options.maxAgeMs))
  )
    return Promise.resolve(cached);
  if (options?.force) workItemInflight.delete(key);
  const pending = workItemInflight.get(key);
  if (pending) return pending;
  const promise = githubRead<GithubWorkItem>("git_github_work_item", {
    cwd,
    repo,
    kind,
    number,
  })
    .then((item) => {
      if (generation === inboxCacheGeneration && workItemInflight.get(key) === promise)
        remember(workItemByKey, key, item, "item");
      return item;
    })
    .finally(() => {
      if (workItemInflight.get(key) === promise) workItemInflight.delete(key);
    });
  workItemInflight.set(key, promise);
  return promise;
}

export function formatGithubQuery(query: GithubWorkItemQuery): string {
  const parts: string[] = [];
  if (query.assignedToMe) parts.push("assignee:@me");
  parts.push(query.kind === "pr" ? "is:pr" : "is:issue");
  if (query.state === "open") parts.push("is:open");
  const text = query.search.trim();
  if (text) parts.push(text);
  return parts.join(" ");
}

export function githubAvatarUrl(login: string, size = 64): string {
  const name = login.trim();
  if (!name) return "";
  return `https://avatars.githubusercontent.com/${encodeURIComponent(name)}?s=${size}`;
}

export function inboxPersonAvatarUrl(
  provider: InboxProvider,
  login: string,
  avatarUrl?: string,
): string {
  const explicit = avatarUrl?.trim() ?? "";
  if (explicit) return explicit;
  if (provider === "github") return githubAvatarUrl(login);
  return "";
}

export function formatRelativeTime(iso: string, now = Date.now(), locale?: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const delta = Math.round((then - now) / 1000);
  const abs = Math.abs(delta);
  const divisions: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.34524, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];
  let value = delta;
  let unit: Intl.RelativeTimeFormatUnit = "second";
  let amount = abs;
  for (const [step, next] of divisions) {
    unit = next;
    if (amount < step) break;
    value = Math.round(value / step);
    amount = Math.abs(value);
  }
  try {
    return relativeTimeFormat(locale, { numeric: "auto" }).format(value, unit);
  } catch {
    return "";
  }
}

export function detailsCacheKey(repo: string, kind: GithubTaskKind, number: number): string {
  return workItemLookupKey(repo, kind, number);
}

export function peekGithubWorkItemDetails(
  repo: string,
  kind: GithubTaskKind,
  number: number,
  cwd?: string,
): GithubWorkItemDetails | null {
  if (!scopeMatches(detailsCacheKey(repo, kind, number), cwd)) return null;
  return detailsByKey.get(detailsCacheKey(repo, kind, number)) ?? null;
}

export async function githubWorkItemDetails(
  cwd: string,
  repo: string,
  kind: GithubTaskKind,
  number: number,
  options?: { maxAgeMs?: number; force?: boolean },
): Promise<GithubWorkItemDetails> {
  ensureItemScope(cwd, repo, kind, number);
  const key = detailsCacheKey(repo, kind, number);
  if (options?.force) {
    detailsByKey.delete(key);
    detailsInflight.delete(key);
  }
  const cached = detailsByKey.get(key);
  if (!options?.force && cached && freshEnough(`details:${key}`, options?.maxAgeMs)) return cached;
  const pending = detailsInflight.get(key);
  if (pending) return pending;
  const generation = inboxCacheGeneration;
  const promise = githubRead<GithubWorkItemDetails>("git_github_work_item_details", {
    cwd,
    repo,
    kind,
    number,
  })
    .then((details) => {
      if (generation === inboxCacheGeneration && detailsInflight.get(key) === promise)
        remember(detailsByKey, key, details, "details");
      return details;
    })
    .finally(() => {
      if (detailsInflight.get(key) === promise) detailsInflight.delete(key);
    });
  detailsInflight.set(key, promise);
  return promise;
}

export function peekGithubWorkItemThread(
  repo: string,
  kind: GithubTaskKind,
  number: number,
  cwd?: string,
): GithubWorkItemThread | null {
  if (!scopeMatches(detailsCacheKey(repo, kind, number), cwd)) return null;
  return threadByKey.get(detailsCacheKey(repo, kind, number)) ?? null;
}

export async function githubWorkItemThread(
  cwd: string,
  repo: string,
  kind: GithubTaskKind,
  number: number,
  options?: { force?: boolean; maxAgeMs?: number },
): Promise<GithubWorkItemThread> {
  ensureItemScope(cwd, repo, kind, number);
  const key = detailsCacheKey(repo, kind, number);
  if (options?.force) {
    threadByKey.delete(key);
    threadInflight.delete(key);
  }
  const cached = threadByKey.get(key);
  if (!options?.force && cached && freshEnough(`thread:${key}`, options?.maxAgeMs)) return cached;
  const generation = inboxCacheGeneration;
  const pending = threadInflight.get(key);
  if (pending) return pending;
  const promise = githubRead<GithubWorkItemThread>("git_github_work_item_thread", {
    cwd,
    repo,
    kind,
    number,
  })
    .then((thread) => {
      if (generation === inboxCacheGeneration && threadInflight.get(key) === promise)
        remember(threadByKey, key, thread, "thread");
      return thread;
    })
    .finally(() => {
      if (threadInflight.get(key) === promise) threadInflight.delete(key);
    });
  threadInflight.set(key, promise);
  return promise;
}

export async function githubWorkItemComment(
  cwd: string,
  repo: string,
  kind: GithubTaskKind,
  number: number,
  body: string,
  options?: { inReplyTo?: string },
): Promise<string> {
  ensureItemScope(cwd, repo, kind, number);
  const generation = inboxCacheGeneration;
  const owner = itemScopes.get(detailsCacheKey(repo, kind, number));
  const url = await invoke<string>("git_github_work_item_comment", {
    cwd,
    repo,
    kind,
    number,
    body: body.trim(),
    inReplyTo: options?.inReplyTo?.trim() ?? "",
  });
  if (
    generation === inboxCacheGeneration &&
    itemScopes.get(detailsCacheKey(repo, kind, number)) === owner
  )
    invalidateGithubWorkItem(repo, kind, number);
  recordInboxSelfActivity({ provider: "github", kind, number, repo });
  return url;
}

/** Run a state-changing pull request action and return GitHub's fresh PR state. */
export async function githubPrAction(
  cwd: string,
  repo: string,
  number: number,
  action: GithubPrAction,
): Promise<GithubWorkItem> {
  ensureItemScope(cwd, repo, "pr", number);
  const generation = inboxCacheGeneration;
  const owner = itemScopes.get(detailsCacheKey(repo, "pr", number));
  const item = await invoke<GithubWorkItem>("git_github_pr_action", {
    cwd,
    repo,
    number,
    action,
  });
  if (
    generation !== inboxCacheGeneration ||
    itemScopes.get(detailsCacheKey(repo, "pr", number)) !== owner
  )
    return item;
  invalidateGithubWorkItem(repo, "pr", number);
  const key = workItemLookupKey(repo, "pr", number);
  remember(workItemByKey, key, item, "item");
  for (const [cacheKey, inboxListCache] of inboxListCaches) {
    inboxListCaches.set(cacheKey, {
      ...inboxListCache,
      items: inboxListCache.items.map((cached) =>
        cached.provider === "github" &&
        cached.kind === "pr" &&
        cached.repo.toLowerCase() === repo.trim().toLowerCase() &&
        cached.number === number
          ? { ...cached, ...item }
          : cached,
      ),
    });
  }
  recordInboxSelfActivity({ provider: "github", kind: "pr", repo, number });
  return item;
}

export function githubReviewDecisionLabel(decision: string): string {
  switch (decision.trim().toUpperCase()) {
    case "APPROVED":
      return "Approved";
    case "CHANGES_REQUESTED":
      return "Changes requested";
    case "REVIEW_REQUIRED":
      return "Review required";
    default:
      return "";
  }
}

export function githubReviewStateLabel(state: string): string {
  switch (state.trim().toUpperCase()) {
    case "APPROVED":
      return "Approved";
    case "CHANGES_REQUESTED":
      return "Requested changes";
    case "DISMISSED":
      return "Dismissed";
    case "COMMENTED":
      return "Commented";
    default:
      return "";
  }
}

export function gitlabAttentionLabel(reason: string): string {
  const action = reason.trim().toLowerCase();
  switch (action) {
    case "assigned":
      return "Assigned to you";
    case "mentioned":
    case "directly_addressed":
      return "Mentioned you";
    case "review_requested":
      return "Review requested";
    case "review_submitted":
      return "Review submitted";
    case "approval_required":
      return "Approval required";
    case "build_failed":
      return "Pipeline failed";
    case "unmergeable":
      return "Cannot be merged";
    case "merge_train_removed":
      return "Removed from merge train";
    case "member_access_requested":
      return "Access requested";
    case "marked":
      return "Added to your to-dos";
    default:
      return action
        .split("_")
        .filter(Boolean)
        .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
        .join(" ");
  }
}

export function prDiffCacheKey(repo: string, number: number, fullContext = false): string {
  return `${repo.trim().toLowerCase()}:pr:${number}${fullContext ? ":full" : ""}`;
}

export function peekGithubPrDiff(
  repo: string,
  number: number,
  fullContext = false,
  cwd?: string,
): GithubPrDiff | null {
  if (!scopeMatches(detailsCacheKey(repo, "pr", number), cwd)) return null;
  return prDiffByKey.get(prDiffCacheKey(repo, number, fullContext)) ?? null;
}

export async function githubPrDiff(
  cwd: string,
  repo: string,
  number: number,
  options?: { fullContext?: boolean; maxAgeMs?: number; force?: boolean },
): Promise<GithubPrDiff> {
  ensureItemScope(cwd, repo, "pr", number);
  const fullContext = options?.fullContext === true;
  const key = prDiffCacheKey(repo, number, fullContext);
  if (options?.force) {
    prDiffByKey.delete(key);
    prDiffInflight.delete(key);
  }
  const cached = prDiffByKey.get(key);
  if (!options?.force && cached && freshEnough(`diff:${key}`, options?.maxAgeMs)) return cached;
  const generation = inboxCacheGeneration;
  const pending = prDiffInflight.get(key);
  if (pending) return pending;
  const promise = githubRead<GithubPrDiff>("git_github_pr_diff", {
    cwd,
    repo,
    number,
    fullContext,
  })
    .then((diff) => {
      if (generation === inboxCacheGeneration && prDiffInflight.get(key) === promise)
        remember(prDiffByKey, key, diff, "diff");
      return diff;
    })
    .finally(() => {
      if (prDiffInflight.get(key) === promise) prDiffInflight.delete(key);
    });
  prDiffInflight.set(key, promise);
  return promise;
}

/** Warm linked-panel data; failures remain retryable when the panel opens. */
export function prefetchGithubWorkItem(
  cwd: string,
  target: { repo: string; kind: GithubTaskKind; number: number },
) {
  const { repo, kind, number } = target;
  const options = { maxAgeMs: GITHUB_WORK_ITEM_FRESH_MS };
  void githubWorkItem(cwd, repo, kind, number, options).catch(() => undefined);
  void githubWorkItemDetails(cwd, repo, kind, number, options).catch(() => undefined);
  void githubWorkItemThread(cwd, repo, kind, number, options).catch(() => undefined);
  if (kind === "pr") void githubPrDiff(cwd, repo, number, options).catch(() => undefined);
}

export async function listInboxItems(
  projects: readonly { path: string }[],
  query: InboxQuery,
  options?: { force?: boolean },
): Promise<InboxListResult> {
  const key = inboxListCacheKey(projects, query);
  if (!options?.force && inboxListIsFresh(projects, query)) {
    return peekInboxList(projects, query) ?? { items: [], errors: {} };
  }
  const pending = inboxListInflight.get(key);
  if (pending) return pending;
  const generation = inboxCacheGeneration;
  const promise = fetchInboxItems(projects, query, options)
    .then((result) => {
      if (generation === inboxCacheGeneration) {
        const previous = inboxListCaches.get(key);
        const failed = new Set(Object.keys(result.errors));
        const items = dedupeInboxItems(
          [...result.items, ...(previous?.items.filter((item) => failed.has(item.provider)) ?? [])],
          projects.map((project) => project.path),
        );
        result = { ...result, items };
        inboxListCaches.delete(key);
        inboxListCaches.set(key, { key, ...result, fetchedAt: Date.now() });
        while (inboxListCaches.size > 16)
          inboxListCaches.delete(inboxListCaches.keys().next().value!);
      }
      return result;
    })
    .finally(() => {
      if (inboxListInflight.get(key) === promise) inboxListInflight.delete(key);
    });
  inboxListInflight.set(key, promise);
  return promise;
}

async function fetchInboxItems(
  projects: readonly { path: string }[],
  query: InboxQuery,
  options?: { force?: boolean },
): Promise<InboxListResult> {
  const unique = uniqueInboxProjects(projects);
  const preferredPaths = unique.map((project) => project.path);

  // Providers are independent, so a slow one does not hold the others back.
  // Each reports its own error; the merge below keeps the fixed provider order.
  const fetchGithub = async (): Promise<{ items: InboxItem[]; error?: string }> => {
    if (query.githubKinds?.length === 0) return { items: [] };
    const discovery = await settleWithLimit(
      unique.map((project) => () => githubRepositories(project.path)),
    );
    const resolved = discovery.flatMap((result, index) =>
      result.status === "fulfilled"
        ? result.value.map((repo) => ({ path: unique[index]!.path, repo }))
        : [],
    );
    const grouped = groupProjectsByRepo(resolved);
    const githubJobs = grouped.flatMap((project) =>
      (query.githubKinds ?? (["issue", "pr"] as const)).map((kind) => async () => {
        const items = await listGithubWorkItems(
          project.path,
          project.repo,
          {
            ...query,
            kind,
          },
          options,
        );
        return items.map((item) => ({
          ...item,
          projectPath: project.path,
          provider: "github" as const,
          repo: item.repo || project.repo,
        }));
      }),
    );
    const discoveryFailures = discovery.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    const github = collectInboxResults(
      [...(await settleWithLimit(githubJobs)), ...discoveryFailures],
      preferredPaths,
    );
    return github.error && unique.length > 0
      ? { items: github.items, error: github.error }
      : { items: github.items };
  };

  const fetchLinear = async (): Promise<{ items: InboxItem[]; error?: string }> => {
    if (!(await linearConnected()).connected) return { items: [] };
    try {
      return { items: await fetchLinearInboxItems(query) };
    } catch (error) {
      return { items: [], error: inboxErrorMessage(error) };
    }
  };

  const fetchJira = async (): Promise<{ items: InboxItem[]; error?: string }> => {
    if (query.jiraEnabled === false) return { items: [] };
    try {
      if (!(await jiraConnected()).connected) return { items: [] };
      return { items: await fetchJiraInboxItems(query) };
    } catch (error) {
      return { items: [], error: inboxErrorMessage(error) };
    }
  };

  const fetchRepositoryProvider = async (
    provider: "gitlab" | "azuredevops",
    connected: () => Promise<{ connected: boolean }>,
  ): Promise<{ items: InboxItem[]; error?: string }> =>
    (await connected()).connected
      ? fetchRepositoryInboxItems(provider, unique, query, preferredPaths)
      : { items: [] };

  const [github, linear, jira, gitlab, azuredevops] = await Promise.all([
    fetchGithub(),
    fetchLinear(),
    fetchJira(),
    fetchRepositoryProvider("gitlab", gitlabConnected),
    fetchRepositoryProvider("azuredevops", azureDevOpsConnected),
  ]);
  const errors: InboxProviderErrors = {};
  if (github.error) errors.github = github.error;
  if (linear.error) errors.linear = linear.error;
  if (jira.error) errors.jira = jira.error;
  if (gitlab.error) errors.gitlab = gitlab.error;
  if (azuredevops.error) errors.azuredevops = azuredevops.error;

  return {
    items: dedupeInboxItems(
      [...github.items, ...linear.items, ...jira.items, ...gitlab.items, ...azuredevops.items],
      preferredPaths,
    ),
    errors,
  };
}

async function fetchRepositoryInboxItems(
  provider: "gitlab" | "azuredevops",
  projects: readonly { path: string }[],
  query: InboxQuery,
  preferredPaths: readonly string[],
): Promise<{ items: InboxItem[]; error?: string }> {
  const { findRepo, listTodos, listWorkItems, toInboxItem } =
    provider === "gitlab"
      ? {
          findRepo: gitlabRepo,
          listTodos: listGitlabTodos,
          listWorkItems: listGitlabWorkItems,
          toInboxItem: gitlabWorkItemToInboxItem,
        }
      : {
          findRepo: azureDevOpsRepo,
          listTodos: listAzureDevOpsTodos,
          listWorkItems: listAzureDevOpsWorkItems,
          toInboxItem: azureDevOpsWorkItemToInboxItem,
        };
  const resolved = (
    await settleWithLimit(
      projects.map((project) => async () => {
        try {
          return {
            path: project.path,
            repo: (await findRepo(project.path)).trim(),
          };
        } catch {
          return { path: project.path, repo: "" };
        }
      }),
    )
  ).flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const grouped = groupProjectsByRepo(resolved.filter((project) => project.repo.length > 0));

  if (query.assignedToMe) {
    const localPathByRepo = new Map(
      grouped.map((project) => [project.repo.toLowerCase(), project.path]),
    );
    const jobs = (["issue", "pr"] as const).map((kind) => async () => {
      const items = await listTodos({
        kind,
        limit: query.state === "all" ? INBOX_ALL_LIMIT : undefined,
      });
      return items.map((item) =>
        toInboxItem(item, localPathByRepo.get(item.repo.toLowerCase()) ?? "", item.repo),
      );
    });
    return collectInboxResults(await settleWithLimit(jobs), preferredPaths);
  }

  const jobs = grouped.flatMap((project) =>
    (["issue", "pr"] as const).map((kind) => async () => {
      const items = await listWorkItems(project.path, {
        kind,
        assignedToMe: false,
        state: query.state,
        limit: query.state === "all" ? INBOX_ALL_LIMIT : undefined,
      });
      return items.map((item) => toInboxItem(item, project.path, project.repo));
    }),
  );
  return collectInboxResults(await settleWithLimit(jobs), preferredPaths);
}

async function fetchLinearInboxItems(query: InboxQuery): Promise<InboxItem[]> {
  const hiddenIds = query.linearHiddenTeamIds ?? loadHiddenLinearTeamIds();
  let teamIds: string[] | null = null;
  if (hiddenIds.length > 0) {
    teamIds = linearTeamIdsForFetch(await listLinearTeams(), hiddenIds);
    if (teamIds?.length === 0) return [];
  }
  const issues = await listLinearIssues({
    assignedToMe: query.assignedToMe,
    state: query.state,
    teamIds: teamIds ?? [],
    limit: query.state === "all" ? INBOX_ALL_LIMIT : undefined,
  });
  const hidden = new Set(hiddenIds);
  return issues
    .filter((issue) => hidden.size === 0 || !hidden.has(issue.teamId))
    .map(linearIssueToInboxItem);
}

function linearIssueToInboxItem(issue: LinearIssue): InboxItem {
  return {
    provider: "linear",
    kind: "linear",
    id: issue.id,
    identifier: issue.identifier,
    number: issue.number,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    stateType: issue.stateType,
    updatedAt: issue.updatedAt,
    labels: issue.labels,
    assignees: issue.assignees,
    draft: false,
    repo: issue.repo,
    teamId: issue.teamId,
    teamName: issue.teamName,
    projectId: issue.projectId || "",
    projectName: issue.projectName || "",
    projectPath: issue.projectPath || "",
  };
}

async function fetchJiraInboxItems(query: InboxQuery): Promise<InboxItem[]> {
  const hiddenIds = query.jiraHiddenProjectIds ?? loadHiddenJiraProjectIds();
  let projectIds: string[] | null = null;
  if (hiddenIds.length > 0) {
    projectIds = jiraProjectIdsForFetch(await listJiraProjects(), hiddenIds);
    if (projectIds?.length === 0) return [];
  }
  const issues = await listJiraIssues({
    assignedToMe: query.assignedToMe,
    state: query.state,
    projectIds: projectIds ?? [],
    limit: query.state === "all" ? INBOX_ALL_LIMIT : undefined,
  });
  const hidden = new Set(hiddenIds);
  return issues
    .filter((issue) => hidden.size === 0 || !hidden.has(issue.teamId))
    .map(jiraIssueToInboxItem);
}

function jiraIssueToInboxItem(issue: JiraIssue): InboxItem {
  return {
    provider: "jira",
    kind: "jira",
    id: issue.id,
    identifier: issue.identifier,
    number: issue.number,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    stateType: issue.stateType,
    updatedAt: issue.updatedAt,
    labels: issue.labels,
    assignees: issue.assignees,
    draft: false,
    repo: issue.repo,
    teamId: issue.teamId,
    teamName: issue.teamName,
    projectPath: issue.projectPath || "",
  };
}

function gitlabWorkItemToInboxItem(
  item: GitlabWorkItem,
  projectPath: string,
  repo: string,
): InboxItem {
  return {
    ...item,
    provider: "gitlab",
    repo: item.repo || repo,
    projectPath,
  };
}

function azureDevOpsWorkItemToInboxItem(
  item: AzureDevOpsWorkItem,
  projectPath: string,
  repo: string,
): InboxItem {
  return {
    ...item,
    provider: "azuredevops",
    repo: item.repo || repo,
    projectPath,
  };
}

export function inboxProjectsForRail(recents: RecentProject[], cwd: string): RecentProject[] {
  const map = collectRailProjects(recents, cwd);
  const current = cwd ? map.get(normalizeProjectPath(cwd)) : undefined;
  const rest = [...map.values()].filter(
    (project) => !current || !sameProjectPath(project.path, current.path),
  );
  return current ? [current, ...rest] : rest;
}

export function uniqueInboxProjects(projects: readonly { path: string }[]): { path: string }[] {
  const seen = new Set<string>();
  const unique: { path: string }[] = [];
  for (const project of projects) {
    const path = normalizeProjectPath(project.path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    unique.push({ path });
  }
  return unique;
}

export function groupProjectsByRepo(
  resolved: readonly { path: string; repo: string }[],
): { path: string; repo: string }[] {
  const seen = new Set<string>();
  const grouped: { path: string; repo: string }[] = [];
  for (const project of resolved) {
    const repo = project.repo.trim().toLowerCase();
    const key = repo || `path:${normalizeProjectPath(project.path)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    grouped.push({
      path: project.path,
      repo: project.repo.trim(),
    });
  }
  return grouped;
}

export function collectInboxResults(
  settled: PromiseSettledResult<InboxItem[]>[],
  preferredPaths: readonly string[] = [],
): { items: InboxItem[]; error?: string } {
  const batches: InboxItem[][] = [];
  const errors: unknown[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") batches.push(result.value);
    else errors.push(result.reason);
  }
  if (batches.length === 0 && errors.length > 0) {
    return { items: [], error: inboxErrorMessage(errors[0]) };
  }
  return { items: dedupeInboxItems(batches.flat(), preferredPaths) };
}

function inboxErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function inboxIdentityKey(item: {
  provider?: InboxProvider;
  kind: InboxKind;
  number: number;
  repo: string;
  url: string;
  identifier?: string;
  id?: string;
}): string {
  if (item.provider === "linear") {
    const identity = item.identifier?.trim() || item.id?.trim();
    if (identity) return identity.toLowerCase();
    return `linear:${item.number}`;
  }
  if (item.provider === "jira") {
    // The numeric id survives an issue moving projects; its key does not.
    const identity = item.id?.trim() || item.identifier?.trim();
    if (identity) return identity.toLowerCase();
    return `jira:${item.number}`;
  }
  const repo = item.repo.trim().toLowerCase();
  if (repo) return `${repo}:${item.kind}:${item.number}`;
  const url = item.url.trim().toLowerCase();
  if (url) return url;
  return `${item.kind}:${item.number}`;
}

export function dedupeInboxItems(
  items: readonly InboxItem[],
  preferredPaths: readonly string[] = [],
): InboxItem[] {
  const rank = new Map(preferredPaths.map((path, index) => [normalizeProjectPath(path), index]));
  const best = new Map<string, InboxItem>();
  for (const item of items) {
    // Keyed with the provider prefix so identical repo/kind/number triples
    // from different providers never collapse into one card.
    const key = inboxItemKey(item);
    const current = best.get(key);
    if (!current || preferInboxItem(item, current, rank)) best.set(key, item);
  }
  return sortInboxItems([...best.values()]);
}

function preferInboxItem(next: InboxItem, current: InboxItem, rank: Map<string, number>): boolean {
  const nextRank = rank.get(normalizeProjectPath(next.projectPath)) ?? Number.POSITIVE_INFINITY;
  const currentRank =
    rank.get(normalizeProjectPath(current.projectPath)) ?? Number.POSITIVE_INFINITY;
  if (nextRank !== currentRank) return nextRank < currentRank;
  return next.projectPath.localeCompare(current.projectPath) < 0;
}

export function sortInboxItems(items: InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => {
    const updated = (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
    if (updated !== 0) return updated;
    if (a.projectPath !== b.projectPath) {
      return a.projectPath.localeCompare(b.projectPath);
    }
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return b.number - a.number;
  });
}

export function inboxItemKey(item: InboxItem): string {
  return `${item.provider}:${inboxIdentityKey(item)}`;
}

export function githubWorkItemKey(item: GithubWorkItem): string {
  return `${item.repo}:${item.kind}:${item.number}`;
}

export function inboxItemStatus(item: {
  kind: InboxKind;
  state: string;
  draft: boolean;
  stateType?: string;
}): string {
  if (item.kind === "linear") {
    const type = item.stateType?.trim().toLowerCase();
    if (type === "completed" || type === "canceled") return "Closed";
    return "Open";
  }
  if (item.kind === "jira") {
    return item.stateType?.trim().toLowerCase() === "done" ? "Closed" : "Open";
  }
  if (item.draft) return "Draft";
  if (item.state === "merged") return "Merged";
  if (item.state === "closed") return "Closed";
  return "Open";
}

export function matchesInboxQuery(item: InboxItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const kind =
    item.kind === "pr"
      ? item.provider === "gitlab"
        ? "merge request mr"
        : "pull request pr"
      : item.kind === "linear"
        ? "linear issue"
        : item.kind === "jira"
          ? "jira issue"
          : "issue";
  const haystack = [
    item.title,
    item.repo,
    item.projectPath,
    item.identifier,
    item.teamName,
    item.projectName,
    item.attentionReason,
    kind,
    `#${item.number}`,
    String(item.number),
    ...item.labels.map((label) => label.name),
    ...item.assignees.map((person) => person.login),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export function filterInboxItems(items: readonly InboxItem[], query: string): InboxItem[] {
  return items.filter((item) => matchesInboxQuery(item, query));
}

export function inboxItemRef(item: {
  provider?: InboxProvider;
  number: number;
  identifier?: string;
}): string {
  if (item.provider === "linear" || item.provider === "jira") {
    return item.identifier?.trim() || `#${item.number}`;
  }
  return `#${item.number}`;
}

export function inboxStartDraft(item: InboxItem, body?: string): string {
  if (item.provider === "linear" || item.provider === "jira") {
    const provider = item.provider === "jira" ? "Jira" : "Linear";
    const id = item.identifier?.trim() || `${provider} #${item.number}`;
    const title = item.title.trim() || id;
    const lines = [`Work on this ${provider} issue:`, "", `${id} ${title}`];
    const url = item.url.trim();
    if (url) lines.push(url);
    const description = body?.trim();
    if (description) {
      lines.push("", description);
    }
    return `${lines.join("\n")}\n`;
  }
  const kind = item.kind === "pr" ? "pull request" : "issue";
  const provider =
    item.provider === "gitlab" ? "GitLab" : item.provider === "azuredevops" ? "ADO" : "GitHub";
  const providerKind = item.provider === "gitlab" && item.kind === "pr" ? "merge request" : kind;
  const title = item.title.trim() || `${provider} ${providerKind} #${item.number}`;
  const lines = [`Work on this ${provider} ${providerKind}:`, "", `#${item.number} ${title}`];
  const url = item.url.trim();
  if (url) lines.push(url);
  return `${lines.join("\n")}\n`;
}

/** Compact chip shown above the composer when starting from Inbox. */
export type InboxComposerCard = {
  provider: InboxProvider;
  kind: InboxKind;
  identifier: string;
  title: string;
  url: string;
  source: string;
  labels: GithubLabel[];
  prompt: string;
};

export function inboxComposerCard(item: InboxItem, body?: string): InboxComposerCard {
  const tracker = item.provider === "linear" || item.provider === "jira";
  return {
    provider: item.provider,
    kind: item.kind,
    identifier: inboxItemRef(item),
    title: item.title.trim() || inboxItemRef(item),
    url: item.url.trim(),
    source: tracker ? item.teamName || item.repo : item.repo,
    labels: item.labels.slice(0, 2),
    prompt: inboxStartDraft(item, body).trimEnd(),
  };
}

export function composeInboxMessage(card: InboxComposerCard | undefined, text: string): string {
  const prompt = card?.prompt.trim() ?? "";
  const note = text.trim();
  if (!prompt) return note;
  if (!note) return prompt;
  return `${prompt}\n\n${note}`;
}
