const KEY = "bycoda.sourceControl.repository.v1:";

export function loadRepositorySelection(scope: string): string {
  try {
    return localStorage.getItem(KEY + scope) ?? "";
  } catch {
    return "";
  }
}

export function saveRepositorySelection(scope: string, selection: string) {
  try {
    localStorage.setItem(KEY + scope, selection);
  } catch {
    // The retained UI state still survives panel remounts in this window.
  }
}
