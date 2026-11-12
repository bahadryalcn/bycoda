import type { JiraDefaultProjects } from "./jiraDefaultProject";

export const JIRA_DEFAULT_PROJECTS_KEY = "bycoda.jiraDefaultProjects";
const CHANGE_EVENT = "bycoda:jira-default-projects";

export function readJiraDefaultProjects(): JiraDefaultProjects {
  return parseJiraDefaultProjects(localStorage.getItem(JIRA_DEFAULT_PROJECTS_KEY));
}

export function parseJiraDefaultProjects(serialized: string | null): JiraDefaultProjects {
  const raw: unknown = JSON.parse(serialized ?? "{}");
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Saved Jira working folders are unavailable.");
  const value = raw as Record<string, unknown>;
  const paths = (field: string): Record<string, string> => {
    const entries = value[field] ?? {};
    if (
      typeof entries !== "object" ||
      Array.isArray(entries) ||
      !Object.values(entries).every((path) => typeof path === "string")
    )
      throw new Error("Saved Jira working folders are unavailable.");
    return entries as Record<string, string>;
  };
  if (value.global !== undefined && typeof value.global !== "string")
    throw new Error("Saved Jira working folders are unavailable.");
  return {
    global: value.global as string | undefined,
    projects: paths("projects"),
    boards: paths("boards"),
    issues: paths("issues"),
  };
}

/** Patch latest settings so a scope edit never replaces sibling or issue choices. */
export function saveJiraDefaultProject(
  scope: "global" | "projects" | "boards" | "issues",
  id: string,
  path: string,
): void {
  const current = readJiraDefaultProjects();
  const next =
    scope === "global"
      ? { ...current, global: path }
      : { ...current, [scope]: { ...current[scope], [id]: path } };
  const serialized = JSON.stringify(next);
  localStorage.setItem(JIRA_DEFAULT_PROJECTS_KEY, serialized);
  if (localStorage.getItem(JIRA_DEFAULT_PROJECTS_KEY) !== serialized)
    throw new Error("Jira working folder was not saved.");
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeJiraDefaultProjects(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (
      (!event.storageArea || event.storageArea === localStorage) &&
      (event.key === null || event.key === JIRA_DEFAULT_PROJECTS_KEY)
    )
      listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}
