import { z } from "zod";
import { IdentifierSchema, JsonValueSchema, SafeCounterSchema } from "./schemas";

const base = { projectId: IdentifierSchema, cwd: z.string().optional() };
// Semantic branch limits remain in the Git owner shared with legacy HTTP.
const branch = z.string();
export const GitReadParamsSchema = z.strictObject(base);
export const GitSwitchParamsSchema = z.strictObject({
  ...base,
  branch,
  remote: z.string().optional(),
});
export const GitCreateBranchParamsSchema = z.strictObject({ ...base, branch });
export const GitWorktreeCreateParamsSchema = z.strictObject({
  ...base,
  branch,
  base: z.string().optional(),
  existing: z.boolean().optional(),
});
export const GitFileDiffParamsSchema = z.strictObject({
  ...base,
  path: z.string(),
  staged: z.boolean().optional(),
});
export const GitActionParamsSchema = z.strictObject({
  ...base,
  action: z.enum([
    "resolveContents",
    "stageContents",
    "stageFiles",
    "unstageFiles",
    "stage",
    "unstage",
    "stageAll",
    "unstageAll",
    "discard",
    "discardFiles",
    "discardAll",
    "commit",
    "push",
    "createPr",
  ]),
  path: z.union([z.string(), z.array(z.string()).max(100_000)]).optional(),
  message: z.string().optional(),
  content: z.string().optional(),
  expectedOriginal: z.string().optional(),
});
export const GitBranchesSchema = z.strictObject({
  current: z.string().nullable(),
  branches: z.array(z.string()),
  remotes: z.array(z.strictObject({ remote: z.string(), name: z.string() })),
});
export const GitWorktreeSchema = z.strictObject({
  path: z.string(),
  branch: z.string().nullable(),
  head: z.string(),
  isMain: z.boolean(),
  missing: z.boolean(),
  locked: z.boolean().optional(),
});
export const GitWorktreesSchema = z.strictObject({
  worktrees: z.array(GitWorktreeSchema),
  defaultRoot: z.string(),
});
export const GitFileDiffSchema = z.strictObject({
  path: z.string(),
  relative: z.string(),
  status: z.string(),
  original: z.string(),
  current: z.string(),
  binary: z.boolean(),
  tooLarge: z.boolean(),
});
export const GitIndexSchema = z.strictObject({
  repository: z.boolean().optional(),
  branch: z.string().nullable(),
  head: z.string().nullable(),
  files: z.array(
    z.strictObject({
      path: z.string(),
      relative: z.string(),
      status: z.string(),
      additions: SafeCounterSchema,
      deletions: SafeCounterSchema,
      staged: z.boolean(),
      unstaged: z.boolean(),
    }),
  ),
  additions: SafeCounterSchema,
  deletions: SafeCounterSchema,
  remote: z.string().nullable(),
  upstream: z.string().nullable(),
  defaultBranch: z.string().nullable(),
  ahead: SafeCounterSchema,
  behind: SafeCounterSchema,
  aheadOfDefault: SafeCounterSchema,
  headPushed: z.boolean(),
  conflicts: z.array(JsonValueSchema).optional(),
  operation: JsonValueSchema.optional(),
});
export type GitReadParams = z.infer<typeof GitReadParamsSchema>;
export type GitSwitchParams = z.infer<typeof GitSwitchParamsSchema>;
export type GitCreateBranchParams = z.infer<typeof GitCreateBranchParamsSchema>;
export type GitWorktreeCreateParams = z.infer<typeof GitWorktreeCreateParamsSchema>;
export type GitFileDiffParams = z.infer<typeof GitFileDiffParamsSchema>;
export type GitActionParams = z.infer<typeof GitActionParamsSchema>;
export type GitBranches = z.infer<typeof GitBranchesSchema>;
export type GitWorktree = z.infer<typeof GitWorktreeSchema>;
export type GitWorktrees = z.infer<typeof GitWorktreesSchema>;
export type GitIndex = z.infer<typeof GitIndexSchema>;
export type GitFileDiff = z.infer<typeof GitFileDiffSchema>;
export const GitActionResultSchema = z.string().nullable();
