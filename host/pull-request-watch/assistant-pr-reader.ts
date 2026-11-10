import type { PrObservation, PrReader } from "../assistant/work/assistant-pr-watch";
import { summarizeChecks } from "./pull-request-model";

export const PR_READER_DEADLINE_MS = 15_000;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("GitHub did not answer in time")), ms);
  });
  work.catch(() => undefined);
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** Parses `gh pr view --json state,title,reviewDecision,statusCheckRollup`. */
export function parseAssistantPrView(raw: string): PrObservation {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || typeof value.state !== "string" || !value.state)
    throw new Error("GitHub returned no pull request state.");
  const checks = summarizeChecks(value.statusCheckRollup).overall;
  return {
    state: value.state.toUpperCase(),
    merged: value.state.toUpperCase() === "MERGED",
    checks,
    ...(typeof value.reviewDecision === "string" && value.reviewDecision
      ? { reviewDecision: value.reviewDecision }
      : {}),
    ...(typeof value.title === "string" ? { title: value.title } : {}),
  };
}

/**
 * Reads pull requests through the Host's `gh` (same sign-in as the Git panel and session
 * watches). Only `repo view` and `pr view` are ever issued.
 */
export function ghPrReader(
  gh: (cwd: string, args: string[]) => Promise<string>,
  projectCwd: (projectId: string) => Promise<string>,
  deadlineMs = PR_READER_DEADLINE_MS,
): PrReader {
  return {
    async repoOf(projectId) {
      const cwd = await projectCwd(projectId);
      const raw = await withDeadline(
        gh(cwd, ["repo", "view", "--json", "nameWithOwner"]),
        deadlineMs,
      );
      const name = (JSON.parse(raw) as { nameWithOwner?: unknown }).nameWithOwner;
      if (typeof name !== "string" || !REPO.test(name))
        throw new Error("This project has no GitHub remote.");
      return name;
    },
    async view(projectId, repo, number) {
      if (!REPO.test(repo)) throw new Error("repo must be owner/name.");
      const cwd = await projectCwd(projectId);
      return parseAssistantPrView(
        await withDeadline(
          gh(cwd, [
            "pr",
            "view",
            String(number),
            "--repo",
            repo,
            "--json",
            "state,title,reviewDecision,statusCheckRollup",
          ]),
          deadlineMs,
        ),
      );
    },
  };
}
