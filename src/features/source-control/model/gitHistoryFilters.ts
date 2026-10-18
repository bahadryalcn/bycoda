import type { GitHistoryCommit } from "../../../platform/tauri/fs";

export type GitHistoryFilters = {
  subject: string;
  author: string;
  sha: string;
  after: string;
  before: string;
};

export const EMPTY_HISTORY_FILTERS: GitHistoryFilters = {
  subject: "",
  author: "",
  sha: "",
  after: "",
  before: "",
};

/** Date fields use local calendar days, including the entire end day. */
export function matchesHistoryFilters(
  commit: GitHistoryCommit,
  filters: GitHistoryFilters,
): boolean {
  for (const field of ["subject", "author", "sha"] as const) {
    if (!commit[field].toLocaleLowerCase().includes(filters[field].trim().toLocaleLowerCase()))
      return false;
  }
  const date = new Date(commit.timestamp * 1000);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return (!filters.after || day >= filters.after) && (!filters.before || day <= filters.before);
}
