import { isRemoteProjectPath, normalizeProjectPath, pathKey } from "../../../shared/lib/paths";
import { githubRead } from "./githubReadGate";

const repoByPath = new Map<string, string>();
const repositoriesByPath = new Map<string, string[]>();

export function clearGithubRepositories() {
  repoByPath.clear();
  repositoriesByPath.clear();
}

export function peekGithubRepositories(cwd: string): readonly string[] | undefined {
  return repositoriesByPath.get(pathKey(cwd));
}

export async function githubRepo(cwd: string): Promise<string> {
  const key = pathKey(cwd);
  const cached = repoByPath.get(key) ?? repositoriesByPath.get(key)?.[0];
  if (cached !== undefined) return cached;
  const repo = await githubRead<string>("git_github_repo", { cwd });
  repoByPath.set(key, repo);
  return repo;
}

export async function githubRepositories(cwd: string): Promise<string[]> {
  const key = pathKey(cwd);
  const cached = repositoriesByPath.get(key);
  if (cached) return cached;
  const repositories = await githubRead<string[]>("git_github_repositories", { cwd });
  if (repositories.length === 0) throw new Error("GitHub did not return a repository");
  repositoriesByPath.set(key, repositories);
  repoByPath.set(key, repositories[0]!);
  return repositories;
}

/** Automatic local discovery is optional; explicit repository operations remain strict. */
export async function discoverGithubRepositories(cwd: string): Promise<string[]> {
  // GitHub's native commands are local-only. Never pass another machine's key to gh.
  if (isRemoteProjectPath(cwd) || /^remote:/i.test(cwd)) return [];
  try {
    return await githubRepositories(normalizeProjectPath(cwd));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Expected stale recents/non-repository folders. Auth, permissions, executable,
    // network failures and malformed provider responses must stay visible and retryable.
    if (
      /not a git repository|^no git remotes found\s*$|\(os error 267\)/i.test(message) &&
      !/executable|program|command not found|failed to (?:spawn|start)|gh(?:\.exe)?:/i.test(message)
    )
      return [];
    throw error;
  }
}
