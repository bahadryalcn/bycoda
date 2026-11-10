import { isDeepStrictEqual } from "node:util";
import { execFileAsync } from "../../src/shared/lib/processExecution.node";
import { hostGitStarts } from "../git/git-start-gate";
import { scrubRuntimeLogText } from "../execution/runtime-logs";

/** Voice Git push and merge. Fixed argv only: no force, delete, mirror, tags, rebase,
 * reset or strategy options exist. The owner approves the Host-computed `review`; the
 * Host recomputes it inside the Git mutation lock and aborts on any difference. */
const text = { type: "string", minLength: 1, maxLength: 4096 };
const name = { type: "string", minLength: 1, maxLength: 255 };
const reviewObject = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
  description:
    "Pass the exact review object returned by the matching preview tool, unchanged. The Host aborts if the repository no longer matches it.",
});
const sha = { type: "string", pattern: "^[a-f0-9]{40,64}$" };
const commits = { type: "array", maxItems: 10, items: { type: "string", maxLength: 160 } };
const tool = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export const GIT_PUBLISH_TOOLS = {
  "git.pushPreview": tool({
    remote: { ...name, description: "Only when the owner named a remote." },
    branch: {
      ...name,
      description: "Only when the owner named a branch; must be the current branch.",
    },
    setUpstream: {
      type: "boolean",
      description: "Only when the owner asked to set the upstream; needs remote and branch.",
    },
  }),
  "git.push": tool(
    {
      requestId: text,
      review: reviewObject({
        repo: text,
        localBranch: name,
        headSha: sha,
        remote: name,
        remoteUrl: text,
        targetRef: text,
        trackingSha: { type: ["string", "null"] },
        setUpstream: { type: "boolean" },
        commitCount: { type: "integer", minimum: 1 },
        commits,
      }),
    },
    ["requestId", "review"],
  ),
  "git.mergePreview": tool({ source: { ...name, description: "Local source branch to merge." } }, [
    "source",
  ]),
  "git.merge": tool(
    {
      requestId: text,
      review: reviewObject({
        repo: text,
        currentBranch: name,
        headSha: sha,
        source: name,
        sourceSha: sha,
        mode: { enum: ["fast-forward", "merge-commit"] },
        commitCount: { type: "integer", minimum: 1 },
        commits,
      }),
    },
    ["requestId", "review"],
  ),
} as const;
export const GIT_PUBLISH_READS = new Set(["git.pushPreview", "git.mergePreview"]);
export type GitPublishAction = "git.push" | "git.merge";
export const isGitPublishAction = (action: string): action is keyof typeof GIT_PUBLISH_TOOLS =>
  Object.hasOwn(GIT_PUBLISH_TOOLS, action);

type Review = Record<string, unknown>;
const GIT_TIMEOUT = 30_000;
const NETWORK_TIMEOUT = 120_000;
async function git(cwd: string, args: string[], timeout = GIT_TIMEOUT) {
  await hostGitStarts.enter();
  return (
    await execFileAsync("git", ["-c", "core.pager=cat", ...args], {
      cwd,
      windowsHide: true,
      timeout,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_MERGE_AUTOEDIT: "no",
      },
    })
  ).stdout.trim();
}
const optional = (cwd: string, args: string[]) => git(cwd, args).catch(() => "");
const succeeds = (cwd: string, args: string[]) =>
  git(cwd, args).then(
    () => true,
    () => false,
  );
const line = (value: string) =>
  // eslint-disable-next-line no-control-regex -- strip control and bidi characters from review text
  value.replace(/[\u0000-\u001f\u007f؜‎‏‪-‮⁦-⁩]/g, " ").slice(0, 160);
const subjects = (value: string) => value.split("\n").filter(Boolean).slice(0, 10).map(line);
/** Credentials never appear in review, approval or receipts. */
export function stripRemoteCredentials(url: string) {
  return line(
    url
      .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, "$1")
      .replace(/([?&#])(?:access_)?token=[^&#]*/gi, "$1token=***"),
  );
}
async function branchName(cwd: string, value: unknown, label: string) {
  if (typeof value !== "string" || !value || value.startsWith("-") || value.includes(":"))
    throw new Error(`Invalid ${label} name.`);
  await git(cwd, ["check-ref-format", "--branch", value]).catch(() => {
    throw new Error(`Invalid ${label} name.`);
  });
  return value;
}
async function currentBranch(cwd: string) {
  const branch = await optional(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]);
  if (!branch) throw new Error("Detached HEAD: check out a branch first.");
  return branch;
}

export async function gitPushReview(cwd: string, input: Review): Promise<Review> {
  const local = await currentBranch(cwd);
  const headSha = await git(cwd, ["rev-parse", "--verify", "HEAD"]);
  const named = input.remote !== undefined || input.branch !== undefined;
  if (input.setUpstream === true && !(input.remote !== undefined && input.branch !== undefined))
    throw new Error("Setting an upstream needs the remote and branch the owner named.");
  let remote: string, branch: string;
  if (named) {
    if (input.remote === undefined || input.branch === undefined)
      throw new Error("Name both remote and branch, or neither to use the upstream.");
    remote = String(input.remote);
    branch = await branchName(cwd, input.branch, "branch");
    // Only the current branch can be pushed; a different local ref is never sent.
    if (branch !== local) throw new Error("Only the current branch can be pushed to its own name.");
    if (!/^[A-Za-z0-9._-]+$/.test(remote) || remote.startsWith("-"))
      throw new Error("Invalid remote name.");
    if (!(await git(cwd, ["remote"])).split("\n").includes(remote))
      throw new Error("Unknown remote.");
  } else {
    remote = await optional(cwd, ["config", "--get", `branch.${local}.remote`]);
    const merge = await optional(cwd, ["config", "--get", `branch.${local}.merge`]);
    if (!remote || !merge.startsWith("refs/heads/") || remote === ".")
      throw new Error("No upstream is configured; name the remote and branch.");
    branch = merge.slice("refs/heads/".length);
    if (branch !== local)
      throw new Error("The upstream branch has a different name; name remote and branch.");
  }
  const tracking = await optional(cwd, [
    "rev-parse",
    "--verify",
    "-q",
    `refs/remotes/${remote}/${branch}`,
  ]);
  if (tracking && !(await succeeds(cwd, ["merge-base", "--is-ancestor", tracking, headSha])))
    throw new Error(
      "Remote history is not an ancestor of HEAD; pull or merge first. Never forced.",
    );
  const range = tracking ? [`${tracking}..${headSha}`] : [headSha, "--not", `--remotes=${remote}`];
  const commitCount = Number(await git(cwd, ["rev-list", "--count", ...range]));
  if (!commitCount) throw new Error("Nothing to push.");
  const log = await git(cwd, ["log", "--no-color", "--max-count=10", "--format=%h %s", ...range]);
  return {
    repo: cwd,
    localBranch: local,
    headSha,
    remote,
    remoteUrl: stripRemoteCredentials(await git(cwd, ["remote", "get-url", "--push", remote])),
    targetRef: `refs/heads/${branch}`,
    trackingSha: tracking || null,
    setUpstream: input.setUpstream === true,
    commitCount,
    commits: subjects(log),
  };
}
async function runPush(cwd: string, review: Review) {
  const target = String(review.targetRef);
  const input: Review = {
    remote: review.remote,
    branch: target.replace(/^refs\/heads\//, ""),
    ...(review.setUpstream === true ? { setUpstream: true } : {}),
  };
  const current = await gitPushReview(cwd, input);
  if (!isDeepStrictEqual(current, review))
    throw new Error("Repository, HEAD or upstream changed after review; preview again.");
  const source =
    review.setUpstream === true ? `refs/heads/${review.localBranch}` : String(review.headSha);
  const output = await git(
    cwd,
    [
      "push",
      ...(review.setUpstream === true ? ["--set-upstream"] : []),
      "--",
      String(review.remote),
      `${source}:${target}`,
    ],
    NETWORK_TIMEOUT,
  );
  return {
    pushed: review.headSha,
    ref: target,
    remote: review.remote,
    output: scrubRuntimeLogText(output, 4000),
  };
}

export async function gitMergeReview(cwd: string, input: Review): Promise<Review> {
  const current = await currentBranch(cwd);
  const source = await branchName(cwd, input.source, "source branch");
  if (source === current) throw new Error("Source is the current branch.");
  const headSha = await git(cwd, ["rev-parse", "--verify", "HEAD"]);
  const sourceSha = await optional(cwd, [
    "rev-parse",
    "--verify",
    "-q",
    `refs/heads/${source}^{commit}`,
  ]);
  if (!sourceSha) throw new Error("Source must be an existing local branch.");
  if (await optional(cwd, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]))
    throw new Error("A merge is already in progress.");
  if (await git(cwd, ["status", "--porcelain=v1", "--untracked-files=no"]))
    throw new Error("Merge requires a clean working tree and index.");
  const count = Number(await git(cwd, ["rev-list", "--count", `${headSha}..${sourceSha}`]));
  if (!count) throw new Error("Already up to date.");
  const fastForward = await succeeds(cwd, ["merge-base", "--is-ancestor", headSha, sourceSha]);
  if (!fastForward) {
    // merge-tree exits 1 and lists conflicted paths without touching the checkout.
    const conflict = await git(cwd, [
      "merge-tree",
      "--write-tree",
      "--name-only",
      headSha,
      sourceSha,
    ]).then(
      () => undefined,
      (error: { stdout?: string }) => String(error.stdout ?? ""),
    );
    if (conflict !== undefined) {
      const files = conflict.split("\n").slice(1).filter(Boolean);
      const end = files.findIndex((row) => /^CONFLICT|^Auto-merging/.test(row));
      throw new Error(
        `Merge would conflict in: ${line((end < 0 ? files : files.slice(0, end)).slice(0, 20).join(", "))}`,
      );
    }
  }
  const log = await git(cwd, [
    "log",
    "--no-color",
    "--max-count=10",
    "--format=%h %s",
    `${headSha}..${sourceSha}`,
  ]);
  return {
    repo: cwd,
    currentBranch: current,
    headSha,
    source,
    sourceSha,
    mode: fastForward ? "fast-forward" : "merge-commit",
    commitCount: count,
    commits: subjects(log),
  };
}
async function runMerge(cwd: string, review: Review) {
  const now = await gitMergeReview(cwd, { source: review.source });
  if (!isDeepStrictEqual(now, review))
    throw new Error("Repository, HEAD or source changed after review; preview again.");
  const sourceSha = String(review.sourceSha);
  const args =
    review.mode === "fast-forward"
      ? ["merge", "--ff-only", "--", sourceSha]
      : [
          "merge",
          "--no-ff",
          "--no-edit",
          "-m",
          `Merge branch '${review.source}' into ${review.currentBranch}`,
          "--",
          sourceSha,
        ];
  try {
    return {
      merged: sourceSha,
      mode: review.mode,
      output: scrubRuntimeLogText(await git(cwd, args, NETWORK_TIMEOUT), 4000),
    };
  } catch (error) {
    const conflicts = (await optional(cwd, ["diff", "--name-only", "--diff-filter=U"]))
      .split("\n")
      .filter(Boolean)
      .slice(0, 20)
      .map(line);
    if (await optional(cwd, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]))
      await git(cwd, ["merge", "--abort"]).catch(() => undefined);
    const restored =
      (await optional(cwd, ["rev-parse", "HEAD"])) === review.headSha &&
      !(await optional(cwd, ["status", "--porcelain=v1", "--untracked-files=no"]));
    const reason = error instanceof Error ? scrubRuntimeLogText(error.message, 500) : "failed";
    throw new Error(
      `Merge aborted${conflicts.length ? `; conflicting files: ${conflicts.join(", ")}` : ""}. ${restored ? "Checkout restored." : "Checkout may not be restored; inspect it."} ${reason}`,
    );
  }
}
/** Called only inside HostGitService.managedAction after native approval. */
export const runGitPublish = (
  cwd: string,
  action: GitPublishAction,
  review: Review,
): Promise<unknown> => (action === "git.push" ? runPush(cwd, review) : runMerge(cwd, review));
export const gitPublishPreview = (cwd: string, action: string, input: Review) =>
  action === "git.pushPreview" ? gitPushReview(cwd, input) : gitMergeReview(cwd, input);
