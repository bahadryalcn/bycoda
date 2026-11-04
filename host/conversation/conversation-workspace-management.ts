import { z } from "zod";
import type { RuntimeLogSubjectPrincipal } from "../runtime-log-tools";
import type { ManagedWorkspace, WorkspaceOwner } from "../workspace-contracts";
import type {
  BranchDeliveryService,
  WorkspaceFeatureClaims,
  WorkspaceRegistry,
  WorkspaceRemovalService,
} from "../workspace-service-contracts";

const text = z
  .string()
  .min(1)
  .max(300)
  .regex(/^\S(?:[\s\S]*\S)?$/);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const target = { workspaceId: text };
const reviewed = { ...target, expectedRevision: revision };
const mutation = { ...reviewed, requestId: text };
const schemas = {
  "workspaces.prepare": z.strictObject({
    requestId: text,
    owner: z.strictObject({ kind: z.enum(["session", "task"]), id: text }),
    slug: z.string().min(1).max(100),
    mode: z.literal("worktree"),
    baseRef: z.string().min(1).max(300).optional(),
    featureKey: z.string().min(1).max(512).optional(),
  }),
  "workspaces.featureClaims.acquire": z.strictObject({
    ...mutation,
    featureKey: z.string().min(1).max(512),
    scope: z.string().min(1).max(512).optional(),
  }),
  "workspaces.featureClaims.release": z.strictObject({ ...mutation, claimId: text }),
  "workspaces.cleanup.plan": z.strictObject(reviewed),
  "workspaces.cleanup.status": z.strictObject({
    ...target,
    operationId: text.optional(),
    offset: revision.optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  "workspaces.delivery.review": z.strictObject({ ...reviewed, action: z.literal("merge") }),
};
export type WorkspaceManagementAction = keyof typeof schemas;
export const WORKSPACE_MANAGEMENT_TOOLS = {
  "workspaces.prepare": z.toJSONSchema(schemas["workspaces.prepare"]),
  "workspaces.featureClaims.acquire": z.toJSONSchema(schemas["workspaces.featureClaims.acquire"]),
  "workspaces.featureClaims.release": z.toJSONSchema(schemas["workspaces.featureClaims.release"]),
  "workspaces.cleanup.plan": z.toJSONSchema(schemas["workspaces.cleanup.plan"]),
  "workspaces.cleanup.status": z.toJSONSchema(schemas["workspaces.cleanup.status"]),
  "workspaces.delivery.review": z.toJSONSchema(schemas["workspaces.delivery.review"]),
} as const;
export const WORKSPACE_MANAGEMENT_READS = new Set<string>([
  "workspaces.cleanup.plan",
  "workspaces.cleanup.status",
  "workspaces.delivery.review",
]);
export const isWorkspaceManagementAction = (action: string): action is WorkspaceManagementAction =>
  Object.hasOwn(schemas, action);
export function describeWorkspaceManagementTool(action: string) {
  if (action === "workspaces.prepare")
    return "Prepare an explicitly requested managed worktree for an existing session or task in this project after native owner approval. mode must be worktree; source checkout/default policy remains unchanged. Reuse requestId after uncertainty. Does not start, move or retarget the owner.";
  if (action.startsWith("workspaces.featureClaims."))
    return "Acquire or release a feature scope for the exact managed workspace after native owner approval and revision validation. Conflicts stay visible; acquisition is not another session's acknowledgment. No automatic worktree switch or takeover.";
  if (action === "workspaces.cleanup.plan")
    return "Inspect a revision-bound workspace directory cleanup plan, including active/dirty/unknown blockers. Never applies cleanup or removes branches. Lists may be truncated; unknown state is not safe.";
  if (action === "workspaces.cleanup.status")
    return "Read paginated cleanup operation summaries for the exact project workspace. No cleanup, recovery or deletion is started.";
  if (action === "workspaces.delivery.review")
    return "Review source and target commit identities and merge blockers for a managed workspace. This read does not merge, push or publish. Truncated details and unknown checks are not approval.";
  return undefined;
}

export type WorkspaceManagementPorts = {
  environmentId: string;
  ownerProject(owner: WorkspaceOwner): Promise<string | undefined>;
  workspace(id: string): Promise<ManagedWorkspace | null>;
  assertWritable(id: string): Promise<void>;
  registry: Pick<WorkspaceRegistry, "prepare">;
  featureClaims: Pick<WorkspaceFeatureClaims, "acquire" | "release">;
  removal: Pick<WorkspaceRemovalService, "plan" | "status">;
  delivery: Pick<BranchDeliveryService, "review">;
  reviewTaskDelivery(taskId: string): Promise<unknown>;
};

function boundPlan(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const result = { ...(value as Record<string, unknown>) };
  const truncatedFields: Record<string, number> = {};
  for (const [key, field] of Object.entries(result)) {
    if (Array.isArray(field) && field.length > 100) {
      result[key] = field.slice(0, 100);
      truncatedFields[key] = field.length;
    }
  }
  return { ...result, truncated: Object.keys(truncatedFields).length > 0, truncatedFields };
}

/** The management wrapper owns exact native approvals and durable request receipts. */
export async function dispatchWorkspaceManagement(
  action: WorkspaceManagementAction,
  raw: Record<string, unknown>,
  principal: RuntimeLogSubjectPrincipal,
  authorized: () => Promise<boolean>,
  ports: WorkspaceManagementPorts,
) {
  const check = async () => {
    if (!(await authorized())) throw new Error("Conversation authority revoked.");
  };
  await check();
  const input = schemas[action].parse(raw);
  if (action === "workspaces.prepare") {
    const request = schemas["workspaces.prepare"].parse(input);
    if ((await ports.ownerProject(request.owner)) !== principal.projectId)
      throw new Error("Workspace owner does not belong to this project.");
    await check();
    const result = await ports.registry.prepare({
      projectId: principal.projectId,
      environmentId: ports.environmentId,
      idempotencyKey: request.requestId,
      owner: request.owner,
      slug: request.slug,
      choice: { defaultMode: "worktree" },
      ...(request.baseRef ? { baseRef: request.baseRef } : {}),
      ...(request.featureKey ? { featureKey: request.featureKey } : {}),
    });
    await check();
    return result;
  }
  if (!("workspaceId" in input)) throw new Error("Workspace identity required.");
  const workspace = await ports.workspace(input.workspaceId);
  await check();
  if (
    !workspace ||
    workspace.projectId !== principal.projectId ||
    workspace.environmentId !== ports.environmentId
  )
    throw new Error("Workspace does not belong to this project and execution host.");
  if ("expectedRevision" in input && input.expectedRevision !== workspace.revision)
    throw new Error("Workspace changed; refresh before retrying.");
  let result: unknown;
  if (action === "workspaces.cleanup.status") {
    const request = schemas["workspaces.cleanup.status"].parse(input);
    const status = await ports.removal.status({
      workspaceId: workspace.id,
      ...(request.operationId ? { operationId: request.operationId } : {}),
    });
    await check();
    const offset = request.offset ?? 0,
      limit = request.limit ?? 30;
    const operations = status.operations;
    return {
      workspace: status.workspace,
      operations: operations.slice(offset, offset + limit).map((operation) => ({
        id: operation.id,
        kind: operation.kind,
        phase: operation.phase,
        expectedRevision: operation.expectedRevision,
      })),
      total: operations.length,
      nextOffset: offset + limit < operations.length ? offset + limit : null,
      detail: "Operation journals remain in the workspace owner UI; no cleanup was started.",
    };
  }
  await ports.assertWritable(workspace.id);
  await check();
  if (action === "workspaces.featureClaims.acquire") {
    const { requestId, ...fields } = schemas[action].parse(input);
    result = await ports.featureClaims.acquire({ ...fields, idempotencyKey: requestId });
  } else if (action === "workspaces.featureClaims.release") {
    const { requestId, ...fields } = schemas[action].parse(input);
    result = await ports.featureClaims.release({ ...fields, idempotencyKey: requestId });
  } else if (action === "workspaces.cleanup.plan")
    result = boundPlan(await ports.removal.plan(schemas[action].parse(input)));
  else {
    const request = schemas["workspaces.delivery.review"].parse(input);
    if (
      workspace.owner.kind === "task" &&
      (await ports.ownerProject(workspace.owner)) !== principal.projectId
    )
      throw new Error("Workspace task no longer belongs to this project.");
    await check();
    result = boundPlan(
      workspace.owner.kind === "task"
        ? await ports.reviewTaskDelivery(workspace.owner.id)
        : await ports.delivery.review(request),
    );
  }
  await check();
  return result;
}
