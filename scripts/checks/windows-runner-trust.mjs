/** Standalone machine-owned admission policy. Copy outside the checkout before registration.
 * Routing YAML is not a security boundary. This module has no repository imports.
 */
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const windowsTrustedRepository = "bahadryalcn/bycoda";
export const windowsTrustedRepositoryId = "1413796716";
const fullSha = /^[a-f0-9]{40}$/;
const positiveId = (value) => /^[1-9]\d*$/.test(String(value ?? ""));
const workflowScopes = {
  "ci.yml": { scope: "ci", jobs: ["host", "check"] },
  "windows-runner-check.yml": { scope: "ci", jobs: ["verify"] },
  "release-cache.yml": { scope: "release-cache", jobs: ["warm"] },
  "release.yml": { scope: "package", jobs: ["package"] },
  "release-candidate.yml": { scope: "package", jobs: ["package"] },
  "nightly-candidate.yml": { scope: "package", jobs: ["package"] },
};
export function evaluateWindowsRunnerTrust(
  context,
  { scope = "auto", requireHeavyJob = false } = {},
) {
  const deny = (reason) => ({ allowed: false, reason, scope: null });
  if (!context || typeof context !== "object") return deny("missing-context");
  if (!["auto", "ci", "package", "release-cache"].includes(scope)) return deny("unknown-scope");
  if (
    context.repository !== windowsTrustedRepository ||
    String(context.repositoryId) !== windowsTrustedRepositoryId ||
    context.event?.repository?.full_name !== windowsTrustedRepository ||
    String(context.event?.repository?.id) !== windowsTrustedRepositoryId
  )
    return deny("foreign-repository");
  if (context.defaultBranch !== "main" || context.event.repository.default_branch !== "main")
    return deny("wrong-default-branch");
  if (
    !fullSha.test(context.sha ?? "") ||
    context.workflowSha !== context.sha ||
    !positiveId(context.runId) ||
    !positiveId(context.runAttempt)
  )
    return deny("invalid-source-identity");
  const prefix = `${windowsTrustedRepository}/.github/workflows/`;
  if (typeof context.workflowRef !== "string" || !context.workflowRef.startsWith(prefix))
    return deny("foreign-workflow");
  const match = /^([^@/]+)@(.+)$/.exec(context.workflowRef.slice(prefix.length));
  const rule = workflowScopes[match?.[1]];
  if (!rule || match[2] !== context.ref || (scope !== "auto" && rule.scope !== scope))
    return deny("untrusted-workflow-ref");
  if (requireHeavyJob && !rule.jobs.includes(context.job)) return deny("unexpected-job");
  if (
    ["pull_request", "pull_request_target", "workflow_run", "workflow_call"].includes(
      context.eventName,
    ) ||
    context.event.pull_request
  )
    return deny("untrusted-event");
  const mainBranch = context.ref === "refs/heads/main" && context.refType === "branch";
  if (match[1] === "release.yml") {
    if (
      context.eventName !== "push" ||
      context.refType !== "tag" ||
      !/^refs\/tags\/v\d+\.\d+\.\d+$/.test(context.ref ?? "") ||
      context.event.ref !== context.ref ||
      context.event.deleted === true ||
      !fullSha.test(context.event.after ?? "")
    )
      return deny("untrusted-release-tag");
    // An annotated tag's push object may differ from its resolved commit SHA.
  } else {
    if (!mainBranch) return deny("not-default-branch");
    if (context.eventName === "push") {
      if (
        !["ci.yml", "release-cache.yml"].includes(match[1]) ||
        context.event.ref !== context.ref ||
        context.event.after !== context.sha ||
        context.event.deleted === true
      )
        return deny("untrusted-main-push");
    } else if (context.eventName === "workflow_dispatch") {
      if (!["main", "refs/heads/main"].includes(context.event.ref))
        return deny("unreviewed-manual-ref");
    } else if (context.eventName === "schedule") {
      if (
        match[1] !== "nightly-candidate.yml" ||
        typeof context.event.schedule !== "string" ||
        !context.event.schedule ||
        context.event.schedule.length > 200
      )
        return deny("untrusted-schedule");
    } else return deny("untrusted-event");
  }
  return { allowed: true, reason: "trusted-workflow-source", scope: rule.scope };
}
export function readWindowsRunnerContext(env = process.env) {
  const file = env.GITHUB_EVENT_PATH;
  if (!file) throw new Error("Missing default GitHub event path");
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size <= 0 || stat.size > 2 * 1024 * 1024)
    throw new Error("GitHub event must be bounded regular JSON");
  const event = JSON.parse(readFileSync(file, "utf8"));
  return {
    eventName: env.GITHUB_EVENT_NAME,
    repository: env.GITHUB_REPOSITORY,
    repositoryId: env.GITHUB_REPOSITORY_ID,
    ref: env.GITHUB_REF,
    refType: env.GITHUB_REF_TYPE,
    workflowRef: env.GITHUB_WORKFLOW_REF,
    workflowSha: env.GITHUB_WORKFLOW_SHA,
    sha: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    job: env.GITHUB_JOB,
    defaultBranch: event.repository?.default_branch,
    event,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let result;
  try {
    if (process.argv.length !== 3 || process.argv[2] !== "--pre-job")
      throw new Error("Only machine pre-job admission is supported");
    result = evaluateWindowsRunnerTrust(readWindowsRunnerContext(), { requireHeavyJob: true });
  } catch {
    result = { allowed: false, reason: "invalid-admission-input", scope: null };
  }
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ...result })}\n`);
  if (!result.allowed) process.exitCode = 1;
}
