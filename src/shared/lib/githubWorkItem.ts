export type GithubWorkItemLink = {
  kind: "issue" | "pr";
  repo: string;
  number: number;
  url: string;
};
export const GITHUB_WORK_ITEM_URL_RE =
  /https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(pull|issues)\/(\d+)\b/i;
export const validGithubWorkItemNumber = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0;
export function githubWorkItemUrl(repo: string, kind: "issue" | "pr", number: number): string {
  return `https://github.com/${repo}/${kind === "pr" ? "pull" : "issues"}/${number}`;
}
/** Pure identity parsing: no Inbox state, React or filesystem discovery. */
export function parseGithubWorkItemUrl(message: string): GithubWorkItemLink | null {
  const match = GITHUB_WORK_ITEM_URL_RE.exec(message);
  if (!match) return null;
  const number = Number(match[4]);
  if (!validGithubWorkItemNumber(number)) return null;
  const repo = `${match[1]}/${match[2]}`;
  const kind = match[3].toLowerCase() === "pull" ? "pr" : "issue";
  return { kind, repo, number, url: githubWorkItemUrl(repo, kind, number) };
}
