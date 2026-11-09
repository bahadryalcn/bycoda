import { type GithubPrCheck } from "../model/githubPrChecks";

export function selectedChecksStillFailed(
  selected: readonly GithubPrCheck[],
  current: readonly GithubPrCheck[],
): boolean {
  const failures = new Map<string, number>();
  const identity = (check: GithubPrCheck) =>
    JSON.stringify([check.workflow, check.name, check.url]);
  for (const check of current) {
    if (check.state !== "fail") continue;
    const key = identity(check);
    failures.set(key, (failures.get(key) ?? 0) + 1);
  }
  return selected.every((check) => {
    const key = identity(check);
    const count = failures.get(key) ?? 0;
    if (count === 0) return false;
    failures.set(key, count - 1);
    return true;
  });
}
