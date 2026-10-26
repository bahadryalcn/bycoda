import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, readlink, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { execFileAsync } from "../src/shared/lib/processExecution.node";
import { hostGitRepositoryKey, withHostGitMutation } from "./git-mutations";
import type {
  BranchDeliveryPlan,
  BranchMergeReceipt,
  BranchPublicationReceipt,
  BranchPrReceipt,
  BranchPushReceipt,
  ManagedWorkspace,
  WorkspaceDeliveryOperation,
  WorkspaceOperation,
} from "./workspace-contracts";
import type { WorkspaceRpcRequest } from "./workspace-rpc-contracts";
import type {
  BranchDeliveryService,
  ExecutionActivityReservations,
  WorkspaceOwnerAuthorization,
  WorkspaceRegistry,
} from "./workspace-service-contracts";

export type DeliveryReview = BranchDeliveryPlan & {
  /** Reviewable patch, in addition to the wire contract's path/commit summary. */
  diff: string;
  sourceStatusFingerprint: string;
  targetDirectory: string;
  publicationFingerprint?: string;
};
type Publication = Extract<BranchDeliveryPlan, { action: "publish" }>["publication"];
type DeliveryOperation = WorkspaceDeliveryOperation & {
  plan: DeliveryReview;
  reservationId?: string;
  intendedTargetHead?: string;
  /** Persist before dispatch: an absent receipt after dispatch is unknown, never a retry grant. */
  pendingEffect?: "push" | "pr";
};

export interface DeliveryPublicationAdapter {
  fingerprint(cwd: string, publication: Publication): Promise<string>;
  push(
    cwd: string,
    plan: Extract<BranchDeliveryPlan, { action: "publish" }>,
  ): Promise<BranchPushReceipt>;
  findPush(
    cwd: string,
    plan: Extract<BranchDeliveryPlan, { action: "publish" }>,
  ): Promise<BranchPushReceipt | null>;
  createPr(
    cwd: string,
    plan: Extract<BranchDeliveryPlan, { action: "publish" }>,
  ): Promise<BranchPrReceipt>;
  findPr(
    cwd: string,
    plan: Extract<BranchDeliveryPlan, { action: "publish" }>,
  ): Promise<BranchPrReceipt | null>;
}
/** Transport may use this only when it knows the external mutation never occurred. */
export class DeliveryEffectNotAppliedError extends Error {}
export interface BranchDeliveryOptions {
  registry: WorkspaceRegistry;
  reservations: ExecutionActivityReservations;
  /** Resolve the integration checkout, including when the source directory was retired. */
  targetDirectory(workspace: ManagedWorkspace): Promise<string>;
  /** Required trusted owner-transport verifier. Strings/renderer booleans alone confer no authority. */
  authorize(owner: WorkspaceOwnerAuthorization, plan: BranchDeliveryPlan): Promise<void>;
  evidence?(workspace: ManagedWorkspace): Promise<{
    checks: BranchDeliveryPlan["checks"];
    visualEvidence: string[];
  }>;
  publication?: DeliveryPublicationAdapter;
  now?: () => number;
  planLifetimeMs?: number;
}
const options = (cwd: string) => ({
  cwd,
  windowsHide: true,
  timeout: 120_000,
  maxBuffer: 8 * 1024 * 1024,
  env: {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_MERGE_AUTOEDIT: "no",
  },
});
async function git(cwd: string, args: string[]): Promise<string> {
  return (await execFileAsync("git", args, { ...options(cwd), encoding: "utf8" })).stdout;
}
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const lines = (value: string) => value.trim().split("\n").filter(Boolean);
const pathsOverlap = (left: string, right: string) =>
  left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);

function dirtyPaths(status: string): string[] {
  const entries = status.split("\0");
  const result: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    result.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) result.push(entries[++i]);
  }
  return [...new Set(result)];
}
/** Includes bytes, index stages and rename endpoints; status text alone misses same-status edits. */
async function snapshot(cwd: string, protectedPaths: string[] = []) {
  const [status, index, diff] = await Promise.all([
    git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    git(cwd, ["ls-files", "--stage", "-z"]),
    git(cwd, ["diff", "--binary", "--no-ext-diff", "--no-textconv"]),
  ]);
  // Do not inventory caches wholesale; ignored files that delivery would replace
  // still count as owner data and must block an overlapping merge.
  const ignored = protectedPaths.length
    ? await git(cwd, [
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "-z",
        "--",
        ...protectedPaths,
      ])
    : "";
  const paths = [...new Set([...dirtyPaths(status), ...ignored.split("\0").filter(Boolean)])];
  const digest = createHash("sha256").update(status).update(index).update(diff).update(ignored);
  for (const path of paths.slice().sort()) {
    const absolute = join(cwd, path);
    const rel = relative(cwd, absolute);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\"))
      throw new Error("Unsafe Git status path");
    digest.update(path);
    const info = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
      throw error;
    });
    if (!info) digest.update("missing");
    else if (info.isSymbolicLink()) digest.update(await readlink(absolute));
    else if (info.isFile()) digest.update(await readFile(absolute));
    else digest.update(`other:${info.mode}`);
  }
  return { status, paths, fingerprint: digest.digest("hex") };
}
function validatePublication(publication: Publication, workspace: ManagedWorkspace) {
  if (
    !publication.remote ||
    publication.remote.startsWith("-") ||
    /[\s\0]/.test(publication.remote)
  )
    throw new Error("Invalid publication remote");
  if (!/^[\w.-]+\/[\w.-]+$/.test(publication.repository)) throw new Error("Invalid repository");
  if (
    publication.headBranchRef !== workspace.branchRef ||
    publication.baseBranchRef !== workspace.targetBranchRef
  )
    throw new Error("Publication branches differ from the workspace");
  if (
    !publication.title.trim() ||
    publication.title.includes("\0") ||
    publication.body.includes("\0")
  )
    throw new Error("Invalid publication text");
}

/** Shared task/session delivery. S1 supplies authenticated RPC wiring; agent tools receive no writer methods. */
export class HostBranchDeliveryService implements BranchDeliveryService {
  private readonly plans = new Map<string, DeliveryReview>();
  private readonly now: () => number;
  private readonly publication: DeliveryPublicationAdapter;
  constructor(private readonly dependencies: BranchDeliveryOptions) {
    this.now = dependencies.now ?? Date.now;
    this.publication = dependencies.publication ?? new GitHubDeliveryPublication();
  }
  private async workspace(id: string, revision?: number) {
    const workspace = await this.dependencies.registry.get({ workspaceId: id });
    if (!workspace) throw new Error("Managed workspace not found");
    if (revision !== undefined && workspace.revision !== revision)
      throw new Error("Workspace changed; review again");
    return workspace;
  }
  async review(
    request: WorkspaceRpcRequest<"workspaces.delivery.review">,
  ): Promise<DeliveryReview> {
    const workspace = await this.workspace(request.workspaceId, request.expectedRevision);
    const target = await this.dependencies.targetDirectory(workspace);
    return withHostGitMutation(target, async () => {
      if ((await hostGitRepositoryKey(target)) !== workspace.repositoryId)
        throw new Error("Delivery target belongs to another repository");
      const sourceHead = (
        await git(target, ["rev-parse", "--verify", `${workspace.branchRef}^{commit}`])
      ).trim();
      const targetHead = (
        await git(target, ["rev-parse", "--verify", `${workspace.targetBranchRef}^{commit}`])
      ).trim();
      const blockers: string[] = [];
      if (
        (await git(target, ["symbolic-ref", "--quiet", "HEAD"])).trim() !==
        workspace.targetBranchRef
      )
        blockers.push("Target checkout is on a different branch");
      if (workspace.state === "active") blockers.push("Workspace is still active");
      let sourceStatusFingerprint = "retired";
      if (workspace.directoryState !== "removed") {
        const source = await snapshot(workspace.path);
        sourceStatusFingerprint = source.fingerprint;
        if (source.status)
          blockers.push("Source has uncommitted changes; explicitly finalize and review again");
        if (
          (await git(workspace.path, ["symbolic-ref", "--quiet", "HEAD"])).trim() !==
          workspace.branchRef
        )
          blockers.push("Source checkout is on a different branch");
      }
      const changedPaths = (
        await git(target, [
          "diff",
          "--name-only",
          "-z",
          "--no-renames",
          `${targetHead}...${sourceHead}`,
        ])
      )
        .split("\0")
        .filter(Boolean);
      const targetStatus = await snapshot(target, changedPaths);
      const overlappingPaths = targetStatus.paths.filter((path) =>
        changedPaths.some((change) => pathsOverlap(path, change)),
      );
      if (overlappingPaths.length) blockers.push("Delivery overlaps dirty target paths");
      // Preflight the committed merge without touching either checkout or index.
      if (request.action === "merge") {
        try {
          await git(target, ["merge-tree", "--write-tree", targetHead, sourceHead]);
        } catch {
          blockers.push("Committed branches conflict; resolve in the source and review again");
        }
      } else validatePublication(request.publication, workspace);
      const evidence = (await this.dependencies.evidence?.(workspace)) ?? {
        checks: [{ name: "Verification evidence", status: "unknown" as const }],
        visualEvidence: [],
      };
      if (evidence.checks.some((check) => check.status === "failed"))
        blockers.push("Verification checks failed");
      const common = {
        token: randomUUID(),
        expiresAt: this.now() + (this.dependencies.planLifetimeMs ?? 300_000),
        workspaceId: workspace.id,
        expectedRevision: workspace.revision,
        sourceBranchRef: workspace.branchRef,
        sourceHead,
        targetBranchRef: workspace.targetBranchRef,
        targetHead,
        targetStatusFingerprint: targetStatus.fingerprint,
        sourceStatusFingerprint,
        targetDirectory: target,
        commits: lines(
          await git(target, ["log", "--format=%H %s", `${targetHead}..${sourceHead}`]),
        ),
        changedPaths,
        overlappingPaths,
        ...evidence,
        blockers,
        diff: await git(target, [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          `${targetHead}...${sourceHead}`,
        ]),
      };
      const plan: DeliveryReview =
        request.action === "merge"
          ? { ...common, action: "merge" }
          : {
              ...common,
              action: "publish",
              publication: { ...request.publication },
              publicationFingerprint: await this.publication.fingerprint(
                target,
                request.publication,
              ),
            };
      this.plans.set(plan.token, structuredClone(plan));
      for (const [token, previous] of this.plans)
        if (previous.expiresAt < this.now()) this.plans.delete(token);
      return plan;
    });
  }
  private async revalidate(plan: DeliveryReview, workspace: ManagedWorkspace) {
    const [directory, repository, branch, sourceHead, targetHead, targetStatus, sourceStatus] =
      await Promise.all([
        this.dependencies.targetDirectory(workspace),
        hostGitRepositoryKey(plan.targetDirectory),
        git(plan.targetDirectory, ["symbolic-ref", "--quiet", "HEAD"]),
        git(plan.targetDirectory, ["rev-parse", "--verify", `${plan.sourceBranchRef}^{commit}`]),
        git(plan.targetDirectory, ["rev-parse", "--verify", `${plan.targetBranchRef}^{commit}`]),
        snapshot(plan.targetDirectory, plan.changedPaths),
        workspace.directoryState === "removed" ? Promise.resolve(null) : snapshot(workspace.path),
      ]);
    if (
      workspace.revision !== plan.expectedRevision ||
      workspace.branchRef !== plan.sourceBranchRef ||
      workspace.targetBranchRef !== plan.targetBranchRef ||
      directory !== plan.targetDirectory ||
      repository !== workspace.repositoryId ||
      branch.trim() !== plan.targetBranchRef ||
      sourceHead.trim() !== plan.sourceHead ||
      targetHead.trim() !== plan.targetHead ||
      targetStatus.fingerprint !== plan.targetStatusFingerprint
    )
      throw new Error("Delivery state changed; review again");
    if (sourceStatus && sourceStatus.fingerprint !== plan.sourceStatusFingerprint)
      throw new Error("Source state changed; review again");
    if (
      sourceStatus &&
      (await git(workspace.path, ["symbolic-ref", "--quiet", "HEAD"])).trim() !==
        plan.sourceBranchRef
    )
      throw new Error("Source branch changed; review again");
    if (
      plan.action === "publish" &&
      (await this.publication.fingerprint(plan.targetDirectory, plan.publication)) !==
        plan.publicationFingerprint
    )
      throw new Error("Publication destination changed; review again");
  }
  private plan(
    request: { workspaceId: string; expectedRevision: number; planToken: string },
    action: BranchDeliveryPlan["action"],
  ) {
    const plan = this.plans.get(request.planToken);
    if (
      !plan ||
      plan.action !== action ||
      plan.workspaceId !== request.workspaceId ||
      plan.expectedRevision !== request.expectedRevision ||
      plan.expiresAt < this.now()
    )
      throw new Error("Delivery approval expired or changed; review again");
    if (plan.blockers.length) throw new Error(plan.blockers.join("; "));
    return structuredClone(plan);
  }
  private async save(operation: DeliveryOperation, phase: DeliveryOperation["phase"]) {
    const previous = operation.phase;
    const next = { ...operation, phase, updatedAt: this.now() };
    await this.dependencies.registry.saveOperation(structuredClone(next), previous);
    Object.assign(operation, next);
  }
  private async duplicate(
    request: WorkspaceRpcRequest<"workspaces.delivery.merge">,
    action: BranchDeliveryPlan["action"],
  ) {
    const found = await this.dependencies.registry.findOperation({
      workspaceId: request.workspaceId,
      kind: "delivery",
      idempotencyKey: request.idempotencyKey,
    });
    if (!found) return null;
    if (
      found.kind !== "delivery" ||
      found.plan.token !== request.planToken ||
      found.plan.action !== action ||
      found.expectedRevision !== request.expectedRevision
    )
      throw new Error("Idempotency key was used for a different delivery");
    return found as DeliveryOperation;
  }
  private async begin(
    request: WorkspaceRpcRequest<"workspaces.delivery.merge">,
    plan: DeliveryReview,
  ) {
    if (plan.expiresAt < this.now()) throw new Error("Delivery approval expired; review again");
    if (!request.idempotencyKey.trim()) throw new Error("Idempotency key required");
    const operation: DeliveryOperation = {
      ...request,
      id: randomUUID(),
      kind: "delivery",
      phase: "prepared",
      plan,
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    const reservation = await this.dependencies.reservations.reserve({
      workspaceId: request.workspaceId,
      operationId: operation.id,
      purpose: "delivery",
      expectedRevision: request.expectedRevision,
    });
    operation.reservationId = reservation.id;
    try {
      await this.revalidate(
        plan,
        await this.workspace(request.workspaceId, request.expectedRevision),
      );
      await this.dependencies.registry.saveOperation(operation, null);
      return operation;
    } catch (error) {
      await this.dependencies.reservations.release(reservation.id);
      throw error;
    }
  }
  private async blocked(operation: DeliveryOperation, error: unknown) {
    operation.resumePhase =
      operation.phase === "blocked" || operation.phase === "complete"
        ? operation.resumePhase
        : operation.phase;
    operation.error = {
      code: "DELIVERY_RECONCILIATION_REQUIRED",
      // Child-process errors may contain remote credentials, PR text or arbitrary stderr.
      message:
        error instanceof DeliveryEffectNotAppliedError
          ? "The publication step was rejected before applying; owner retry may resume it"
          : "Delivery was interrupted; reconcile the recorded operation before retrying",
    };
    await this.save(operation, "blocked");
  }
  async merge(
    request: WorkspaceRpcRequest<"workspaces.delivery.merge">,
    owner: WorkspaceOwnerAuthorization,
  ): Promise<BranchMergeReceipt> {
    const duplicate = await this.duplicate(request, "merge");
    const plan = duplicate?.plan ?? this.plan(request, "merge");
    return withHostGitMutation(plan.targetDirectory, async () => {
      await this.dependencies.authorize(owner, plan);
      const existing = await this.duplicate(request, "merge");
      if (existing) {
        if (existing.phase === "complete" && existing.merge) return existing.merge;
        throw new Error("Delivery already started; reconcile its recorded operation");
      }
      const operation = await this.begin(request, plan);
      try {
        const tree = (
          await git(plan.targetDirectory, [
            "merge-tree",
            "--write-tree",
            plan.targetHead,
            plan.sourceHead,
          ])
        ).trim();
        const commit = (
          await git(plan.targetDirectory, [
            "-c",
            "commit.gpgsign=false",
            "commit-tree",
            tree,
            "-p",
            plan.targetHead,
            "-p",
            plan.sourceHead,
            "-m",
            `Merge ${plan.sourceBranchRef} (bycoda owner delivery)`,
          ])
        ).trim();
        operation.intendedTargetHead = commit;
        await this.save(operation, "prepared");
        // read-tree's two-tree merge retains unrelated staged and unstaged entries. It
        // refuses changed overlapping entries; no stash/reset/clean or target commit.
        await this.revalidate(
          plan,
          await this.workspace(request.workspaceId, request.expectedRevision),
        );
        await git(plan.targetDirectory, ["read-tree", "-m", "-u", plan.targetHead, commit]);
        await git(plan.targetDirectory, [
          "update-ref",
          plan.targetBranchRef,
          commit,
          plan.targetHead,
        ]);
        await this.finishMerge(operation, commit);
        return operation.merge!;
      } catch (error) {
        await this.blocked(operation, error);
        throw error;
      }
    });
  }
  private async finishMerge(operation: DeliveryOperation, targetHead: string) {
    const plan = operation.plan;
    operation.merge = {
      operationId: operation.id,
      workspaceId: operation.workspaceId,
      sourceHead: plan.sourceHead,
      previousTargetHead: plan.targetHead,
      targetHead,
      workspaceRevision: operation.expectedRevision + 1,
    };
    await this.save(operation, "merged");
    let workspace = await this.workspace(operation.workspaceId);
    if (workspace.deliveredCommit !== targetHead)
      workspace = await this.dependencies.registry.update({
        workspaceId: workspace.id,
        expectedRevision: workspace.revision,
        idempotencyKey: `delivery:${operation.id}`,
        reservationId: operation.reservationId!,
        changes: { state: "merged", deliveredCommit: targetHead, mergedAt: this.now() },
      });
    operation.merge.workspaceRevision = workspace.revision;
    await this.save(operation, "complete");
    if (operation.reservationId)
      await this.dependencies.reservations.release(operation.reservationId);
  }
  async publish(
    request: WorkspaceRpcRequest<"workspaces.delivery.publish">,
    owner: WorkspaceOwnerAuthorization,
  ): Promise<BranchPublicationReceipt> {
    const duplicate = await this.duplicate(request, "publish");
    const plan = duplicate?.plan ?? this.plan(request, "publish");
    return withHostGitMutation(plan.targetDirectory, async () => {
      await this.dependencies.authorize(owner, plan);
      let operation = await this.duplicate(request, "publish");
      if (operation?.phase === "complete") return operation.publication!;
      if (operation?.pendingEffect) {
        await this.recoverPublication(operation);
        if (operation.pendingEffect) return operation.publication!;
      }
      if (operation)
        await this.revalidate(
          plan,
          await this.workspace(request.workspaceId, request.expectedRevision),
        );
      else operation = await this.begin(request, plan);
      return this.runPublication(operation);
    });
  }
  private async runPublication(operation: DeliveryOperation): Promise<BranchPublicationReceipt> {
    const plan = operation.plan;
    if (plan.action !== "publish") throw new Error("Not a publication operation");
    operation.publication ??= {
      operationId: operation.id,
      workspaceId: operation.workspaceId,
      status: "pending",
    };
    try {
      if (!operation.publication.push) {
        operation.pendingEffect = "push";
        await this.save(operation, "prepared");
        operation.publication.push = await this.publication.push(plan.targetDirectory, plan);
        operation.pendingEffect = undefined;
        await this.save(operation, "pushed");
      }
      if (!operation.publication.pullRequest) {
        operation.pendingEffect = "pr";
        await this.save(operation, "pushed");
        // Reconcile an existing PR before creating, including a retry after a lost receipt.
        operation.publication.pullRequest =
          (await this.publication.findPr(plan.targetDirectory, plan)) ??
          (await this.publication.createPr(plan.targetDirectory, plan));
        operation.pendingEffect = undefined;
        await this.save(operation, "pr-created");
      }
      operation.publication.status = "complete";
      await this.save(operation, "complete");
      if (operation.reservationId)
        await this.dependencies.reservations.release(operation.reservationId);
    } catch (error) {
      if (error instanceof DeliveryEffectNotAppliedError) operation.pendingEffect = undefined;
      operation.publication.status = "blocked";
      await this.blocked(operation, error);
    }
    return operation.publication;
  }
  private async recoverPublication(operation: DeliveryOperation) {
    const plan = operation.plan;
    if (plan.action !== "publish" || !operation.publication || !operation.pendingEffect) return;
    if (
      (await this.publication.fingerprint(plan.targetDirectory, plan.publication)) !==
      plan.publicationFingerprint
    )
      throw new Error(
        "Publication destination changed; reconciliation requires owner intervention",
      );
    if (operation.pendingEffect === "push") {
      const receipt = await this.publication.findPush(plan.targetDirectory, plan);
      if (!receipt) return; // Unknown effects remain held; absence does not authorize another push.
      operation.publication.push = receipt;
      operation.pendingEffect = undefined;
      operation.publication.status = "pending";
      await this.save(operation, "pushed");
    } else {
      const receipt = await this.publication.findPr(plan.targetDirectory, plan);
      if (!receipt) return;
      operation.publication.pullRequest = receipt;
      operation.pendingEffect = undefined;
      operation.publication.status = "complete";
      await this.save(operation, "complete");
      if (operation.reservationId)
        await this.dependencies.reservations.release(operation.reservationId);
    }
  }
  async recover(operationId: string): Promise<WorkspaceOperation> {
    const record = await this.dependencies.registry.getOperation(operationId);
    if (!record || record.kind !== "delivery") throw new Error("Delivery operation not found");
    const operation = record as DeliveryOperation;
    if (operation.phase === "complete") return operation;
    return withHostGitMutation(operation.plan.targetDirectory, async () => {
      if (operation.plan.action === "publish") await this.recoverPublication(operation);
      else if (
        operation.intendedTargetHead &&
        (
          await git(operation.plan.targetDirectory, ["rev-parse", operation.plan.targetBranchRef])
        ).trim() === operation.intendedTargetHead
      )
        await this.finishMerge(operation, operation.intendedTargetHead);
      return operation;
    });
  }
}

/** Default external publication transport. Fixed argv and immutable source SHA; no force pushes. */
export class GitHubDeliveryPublication implements DeliveryPublicationAdapter {
  async fingerprint(cwd: string, publication: Publication) {
    return hash(
      JSON.stringify({
        publication,
        url: (await git(cwd, ["remote", "get-url", "--push", publication.remote])).trim(),
      }),
    );
  }
  async push(cwd: string, plan: Extract<BranchDeliveryPlan, { action: "publish" }>) {
    await git(cwd, [
      "push",
      "--",
      plan.publication.remote,
      `${plan.sourceHead}:${plan.publication.headBranchRef}`,
    ]);
    return {
      remote: plan.publication.remote,
      branchRef: plan.publication.headBranchRef,
      sourceHead: plan.sourceHead,
      pushedAt: Date.now(),
    };
  }
  async findPush(cwd: string, plan: Extract<BranchDeliveryPlan, { action: "publish" }>) {
    const output = await git(cwd, [
      "ls-remote",
      "--refs",
      "--",
      plan.publication.remote,
      plan.publication.headBranchRef,
    ]);
    return output.split(/\s+/)[0] === plan.sourceHead
      ? {
          remote: plan.publication.remote,
          branchRef: plan.publication.headBranchRef,
          sourceHead: plan.sourceHead,
          pushedAt: Date.now(),
        }
      : null;
  }
  private async gh(cwd: string, args: string[]) {
    return (await execFileAsync("gh", args, { ...options(cwd), encoding: "utf8" })).stdout;
  }
  async findPr(
    cwd: string,
    plan: Extract<BranchDeliveryPlan, { action: "publish" }>,
  ): Promise<BranchPrReceipt | null> {
    const entries = JSON.parse(
      await this.gh(cwd, [
        "pr",
        "list",
        "--repo",
        plan.publication.repository,
        "--state",
        "all",
        "--head",
        plan.publication.headBranchRef.replace(/^refs\/heads\//, ""),
        "--base",
        plan.publication.baseBranchRef.replace(/^refs\/heads\//, ""),
        "--json",
        "number,url,headRefOid",
      ]),
    ) as { number: number; url: string; headRefOid: string }[];
    const found = entries.find((entry) => entry.headRefOid === plan.sourceHead);
    return found
      ? {
          repository: plan.publication.repository,
          number: found.number,
          url: found.url,
          sourceHead: plan.sourceHead,
          createdAt: Date.now(),
        }
      : null;
  }
  async createPr(
    cwd: string,
    plan: Extract<BranchDeliveryPlan, { action: "publish" }>,
  ): Promise<BranchPrReceipt> {
    const scratch = await mkdtemp(join(tmpdir(), "bycoda-pr-body-"));
    const bodyFile = join(scratch, "body.txt");
    await writeFile(bodyFile, plan.publication.body, "utf8");
    try {
      await this.gh(cwd, [
        "pr",
        "create",
        "--repo",
        plan.publication.repository,
        "--head",
        plan.publication.headBranchRef.replace(/^refs\/heads\//, ""),
        "--base",
        plan.publication.baseBranchRef.replace(/^refs\/heads\//, ""),
        "--title",
        plan.publication.title,
        "--body-file",
        bodyFile,
      ]);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
    const receipt = await this.findPr(cwd, plan);
    if (!receipt) throw new Error("PR creation outcome is unknown; reconcile before retrying");
    return receipt;
  }
}
