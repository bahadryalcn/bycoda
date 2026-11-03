/** The saved primary project is always the lead. Legacy jobs have one project. */
export function assistantJobProjectIds(job: {
  kind?: string;
  projectId: string | null;
  projectIds?: readonly string[];
  quickAction?: { kind: string; projectId?: string };
}): string[] {
  if (job.kind === "quick") {
    if (job.quickAction?.kind === "automation") {
      if (
        !job.projectId ||
        job.quickAction.projectId !== job.projectId ||
        job.projectIds?.length !== 1 ||
        job.projectIds[0] !== job.projectId
      )
        throw new Error(
          "The quick automation's project scope changed; reload its canonical source.",
        );
      return [job.projectId];
    }
    if (
      job.projectId === null &&
      (!job.quickAction || job.quickAction.kind === "note") &&
      !job.projectIds?.length
    )
      return [];
    throw new Error("The quick job's project scope is unknown; inspect its canonical source.");
  }
  if (job.projectId === null) return [];
  return [...new Set([job.projectId, ...(job.projectIds ?? [])])];
}
export function sameAssistantProjectSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}
