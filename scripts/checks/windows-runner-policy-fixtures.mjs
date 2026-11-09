/** Offline GitHub context fixtures; no runner registration or job execution. */
export function windowsContext({
  workflow = "ci.yml",
  eventName = "push",
  ref = "refs/heads/main",
  job = "host",
} = {}) {
  const sha = "a".repeat(40),
    repository = { full_name: "bahadryalcn/bycoda", id: 1413796716, default_branch: "main" };
  return {
    eventName,
    repository: repository.full_name,
    repositoryId: String(repository.id),
    defaultBranch: "main",
    ref,
    refType: ref.startsWith("refs/tags/") ? "tag" : "branch",
    workflowRef: `${repository.full_name}/.github/workflows/${workflow}@${ref}`,
    workflowSha: sha,
    sha,
    runId: "123",
    runAttempt: "1",
    job,
    event: {
      repository,
      ...(eventName === "push"
        ? { ref, after: sha, deleted: false }
        : eventName === "workflow_dispatch"
          ? { ref: "main" }
          : eventName === "schedule"
            ? { schedule: "23 */6 * * *" }
            : {}),
    },
  };
}
