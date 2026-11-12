import { useState, useSyncExternalStore } from "react";
import type { InboxItem } from "../model/githubTasks";
import { resolveJiraDefaultProject } from "../model/jiraDefaultProject";
import {
  JIRA_DEFAULT_PROJECTS_KEY,
  parseJiraDefaultProjects,
  saveJiraDefaultProject,
  subscribeJiraDefaultProjects,
} from "../model/jiraDefaultProjectState";

function snapshot() {
  try {
    return localStorage.getItem(JIRA_DEFAULT_PROJECTS_KEY);
  } catch {
    return null;
  }
}

/** Keeps the picker's value/onChange contract while persisting explicit Jira choices. */
export function useJiraWorkingProject(
  item: InboxItem,
  fallback: string,
  onError: (error: string | null) => void,
): readonly [string, (path: string) => void] {
  const raw = useSyncExternalStore(subscribeJiraDefaultProjects, snapshot, () => null);
  const [localChoice, setLocalChoice] = useState(fallback);
  let value = localChoice;
  if (item.provider === "jira") {
    try {
      value = resolveJiraDefaultProject(item, parseJiraDefaultProjects(raw), fallback);
    } catch {
      /* Keep the current folder usable; a failed write reports the storage error. */
    }
  }
  const setValue = (path: string) => {
    try {
      if (item.provider === "jira") saveJiraDefaultProject("issues", item.url, path);
      setLocalChoice(path);
      onError(null);
    } catch (error) {
      onError(String(error instanceof Error ? error.message : error));
    }
  };
  return [value, setValue];
}
