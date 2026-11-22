const KEY = "bycoda.sourceControl.onlyRepository.v1:";

/** The repository the Changes panel is narrowed to for a project (VS Code's single-repository mode), or "" for all. */
export function loadOnlyRepository(project: string): string {
  try {
    return localStorage.getItem(KEY + project) ?? "";
  } catch {
    return "";
  }
}

/** An empty `repository` shows all repositories again. */
export function saveOnlyRepository(project: string, repository: string) {
  try {
    if (repository) localStorage.setItem(KEY + project, repository);
    else localStorage.removeItem(KEY + project);
  } catch {
    // The retained UI state still survives panel remounts in this window.
  }
}
