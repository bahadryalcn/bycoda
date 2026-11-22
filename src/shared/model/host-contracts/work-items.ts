import { z } from "zod";

export const GITHUB_WORK_ITEMS = "workItems.github.v1";
export const workItemNumber = z.number().int().min(1).max(2_147_483_647);
const kind = z.enum(["issue", "pr"]);
const projectId = z.string().min(1).max(256);
export const workItemSearchParams = z.strictObject({
  projectId,
  query: z.string().max(200),
  kind: kind.optional(),
});
export const workItemGetParams = z.strictObject({ projectId, number: workItemNumber });
export const workItemRow = z.strictObject({
  kind,
  repo: z.string(),
  number: workItemNumber,
  title: z.string(),
  url: z.string(),
  state: z.string(),
  updatedAt: z.string(),
  draft: z.boolean(),
  body: z.string().optional(),
});
export const workItemResult = z.strictObject({
  items: z.array(workItemRow),
  errors: z.array(
    z.strictObject({
      reason: z.enum(["missing-tool", "unauthenticated", "rate-limited", "not-found", "failed"]),
      message: z.string(),
      retryAt: z.number().int().nonnegative().optional(),
    }),
  ),
});
export type WorkItemResult = z.infer<typeof workItemResult>;
