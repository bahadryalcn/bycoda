type ProjectStore = { project(id: string): Promise<{ cwd: string }> };

/** Records each scoped project's folder, including the thread's own, when a voice context is captured. */
export async function captureVoiceProjectProofs(
  store: ProjectStore,
  projectIds: Iterable<string>,
  threadProjectId?: string,
): Promise<{ projectId: string; cwd: string }[]> {
  const proofs = new Map<string, string>();
  for (const id of projectIds) proofs.set(id, (await store.project(id)).cwd);
  // A missing thread project stays unproven, so the scope check refuses it later.
  if (threadProjectId && !proofs.has(threadProjectId))
    await store.project(threadProjectId).then(
      ({ cwd }) => proofs.set(threadProjectId, cwd),
      () => undefined,
    );
  return [...proofs]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([projectId, cwd]) => ({ projectId, cwd }));
}

/**
 * Adds the captured proofs to those carried by refs, summaries and tickets, then reports whether
 * every scoped project is proven. A captured folder that disagrees with a carried one fails.
 */
export async function proveVoiceScope(
  store: ProjectStore,
  proofs: Map<string, string>,
  scope: string[],
  { projectProofs: captured }: { projectProofs?: { projectId: string; cwd: string }[] },
): Promise<boolean> {
  for (const proof of captured ?? []) {
    if (proofs.has(proof.projectId) && proofs.get(proof.projectId) !== proof.cwd) return false;
    proofs.set(proof.projectId, proof.cwd);
  }
  // shortcut: contexts saved before projectProofs existed use the current folder; remove once they age out.
  if (!captured)
    for (const id of scope)
      if (!proofs.has(id))
        try {
          proofs.set(id, (await store.project(id)).cwd);
        } catch {
          return false;
        }
  return scope.every((projectId) => proofs.has(projectId));
}

/** Proofs for an owner message saved before its project origins were captured; undefined if a project is gone. */
export async function legacyMessageProofs(
  store: ProjectStore,
  projectIds: string[] | undefined,
): Promise<{ projectId: string; cwd: string }[] | undefined> {
  // shortcut: messages saved before origin capture use the current folder; remove once they age out.
  return projectIds && captureVoiceProjectProofs(store, projectIds).catch(() => undefined);
}
