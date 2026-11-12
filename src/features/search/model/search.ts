import { invokeWorkspace } from "../../../platform/tauri/fs";
import { pathKey, slash } from "../../../shared/lib/paths";

export type ProjectSearchMatch = {
  path: string;
  relative: string;
  line: number;
  column: number;
  preview: string;
};

export type ProjectSearchResult = {
  matches: ProjectSearchMatch[];
  truncated: boolean;
};

export type ProjectSearchOptions = {
  cwd: string;
  query: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  include?: string;
  exclude?: string;
  searchId: string;
};

export type EditorNavigation = {
  line: number;
  column?: number;
};

export type EditorNavigationTarget = EditorNavigation & {
  path: string;
  token: number;
};

export type FileOpenOptions = {
  /** Keep contextual previews beside the conversation, regardless of file-tab preference. */
  placement?: "pane";
  /** The caller obtained this concrete path from the filesystem or file index. */
  exact?: boolean;
  /** Open as a permanent tab instead of the pane's preview tab. */
  pin?: boolean;
};

export type OpenFileFn = (
  path: string,
  navigation?: EditorNavigation,
  options?: FileOpenOptions,
) => void;

export function normalizeEditorPath(path: string): string {
  return slash(path).replace(/\/+$/, "") || path;
}

export function editorPathsEqual(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

export function searchProject(options: ProjectSearchOptions): Promise<ProjectSearchResult> {
  return invokeWorkspace<ProjectSearchResult>("search_project", { options });
}

export function cancelProjectSearch(cwd: string, searchId: string): Promise<void> {
  return invokeWorkspace<void>("cancel_project_search", { cwd, searchId });
}

export type ProjectReplaceResult = {
  filesChanged: number;
  replacements: number;
  failures: string[];
  revisions: Record<string, string>;
};

/** Preview counts and hashes first; only reviewed file revisions may be written. */
export function replaceProject(
  options: ProjectSearchOptions & {
    replacement: string;
    dryRun: boolean;
    revisions?: Record<string, string>;
  },
): Promise<ProjectReplaceResult> {
  return invokeWorkspace<ProjectReplaceResult>("replace_project", { options });
}
