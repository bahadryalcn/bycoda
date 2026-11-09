import { pathKey } from "../../../shared/lib/paths";
import { peekGithubRepositories } from "./githubRepositories";

export function githubRepositoryFilterKey(repo: string): string {
  return `github:${repo.trim().toLowerCase()}`;
}

export function githubRepositoryOptions(projects: readonly { path: string }[]) {
  const options = new Map<
    string,
    { path: string; name: string; logoPath: null; aliases: string[] }
  >();
  for (const project of projects) {
    for (const repo of peekGithubRepositories(project.path) ?? []) {
      const key = githubRepositoryFilterKey(repo);
      const option = options.get(key);
      if (option) option.aliases.push(project.path);
      else options.set(key, { path: key, name: repo, logoPath: null, aliases: [project.path] });
    }
  }
  return [...options.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Old checkout filters still hide the same repository after checkout order changes. */
export function hiddenGithubRepositories(hiddenProjects: Iterable<string>): Set<string> {
  const hidden = new Set<string>();
  for (const path of hiddenProjects) {
    if (path.startsWith("github:")) hidden.add(path.toLowerCase());
    else
      for (const repo of peekGithubRepositories(path) ?? [])
        hidden.add(githubRepositoryFilterKey(repo));
  }
  return hidden;
}

export function repositorySelectionHidden(
  option: { path: string; aliases?: readonly string[] },
  hiddenProjects: readonly string[],
): boolean {
  const keys = new Set(hiddenProjects.map(pathKey));
  return (
    keys.has(pathKey(option.path)) || !!option.aliases?.some((path) => keys.has(pathKey(path)))
  );
}

export function hiddenAfterRepositorySelection(
  options: readonly { path: string; aliases?: readonly string[] }[],
  selected: readonly string[],
  previous: readonly string[],
): string[] {
  const represented = new Set(
    options.flatMap((option) => [option.path, ...(option.aliases ?? [])]).map(pathKey),
  );
  return [
    ...previous.filter((path) => !represented.has(pathKey(path))),
    ...options.filter((option) => !selected.includes(option.path)).map((option) => option.path),
  ];
}
