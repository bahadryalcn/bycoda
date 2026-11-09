import type { OwnerSecret } from "./secretsClient";

export type SecretGroup = { projectId: string; title: string; secrets: OwnerSecret[] };

/**
 * Groups saved secrets by project, projects by title and secrets newest first. A project the
 * client cannot name falls back to its id so the secret is never hidden.
 */
export function groupSecretsByProject(
  secrets: readonly OwnerSecret[],
  projectNames: ReadonlyMap<string, string>,
): SecretGroup[] {
  const groups = new Map<string, SecretGroup>();
  for (const secret of secrets) {
    const group = groups.get(secret.projectId) ?? {
      projectId: secret.projectId,
      title: projectNames.get(secret.projectId) || secret.projectId,
      secrets: [],
    };
    group.secrets.push(secret);
    groups.set(secret.projectId, group);
  }
  for (const group of groups.values())
    group.secrets.sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name));
  return [...groups.values()].sort(
    (a, b) => a.title.localeCompare(b.title) || a.projectId.localeCompare(b.projectId),
  );
}
