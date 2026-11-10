import { z } from "zod";

/** Owner-chosen local folders the global Assistant Room may read and change, plus the owner's
 * "run commands without asking" choice. Carried only by the `folders.*` operations; the
 * Room, voice and every other non-owner principal can read it but never write it. */
export const ASSISTANT_FOLDERS_MAX = 20;

const folderId = z.string().regex(/^f[a-f0-9]{16}$/);

export const AssistantFolderSchema = z.strictObject({
  id: folderId,
  /** Canonical (real) absolute path chosen by the owner. */
  path: z.string().min(1).max(4096),
});
export type AssistantFolder = z.infer<typeof AssistantFolderSchema>;

export const AssistantFoldersResponseSchema = z.strictObject({
  folders: z.array(AssistantFolderSchema).max(ASSISTANT_FOLDERS_MAX),
  runWithoutAsking: z.boolean(),
  version: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type AssistantFoldersResponse = z.infer<typeof AssistantFoldersResponseSchema>;

export const AssistantFoldersGetSchema = z.strictObject({ op: z.literal("folders.get") });
export const AssistantFoldersSetSchema = z.strictObject({
  op: z.literal("folders.set"),
  expectedVersion: z.number().int().nonnegative(),
  paths: z.array(z.string().min(1).max(4096)).max(ASSISTANT_FOLDERS_MAX),
  runWithoutAsking: z.boolean(),
});
export const AssistantFoldersOps = [AssistantFoldersGetSchema, AssistantFoldersSetSchema] as const;
