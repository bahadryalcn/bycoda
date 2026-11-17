import { z } from "zod";

/** A phone may unlock a group or the hidden list only while the desktop renderer is live. */
export const GROUP_LOCK_REMOTE_CAPABILITY = "projects.groupLock.remote.v1";

const GroupIdSchema = z.string().min(1).max(200);
/** Typed so a wrong guess never exceeds what the desktop password field accepts. */
const PasswordSchema = z.string().min(1).max(1024);

export const GroupUnlockParamsSchema = z.strictObject({
  groupId: GroupIdSchema,
  password: PasswordSchema,
});
export const GroupAuthorizeHiddenParamsSchema = z.strictObject({ password: PasswordSchema });
export const GroupLockParamsSchema = z.strictObject({ groupId: GroupIdSchema.optional() });
export const GroupSetHiddenParamsSchema = z.strictObject({
  groupId: GroupIdSchema,
  hidden: z.boolean(),
});

/** Only the verdict leaves the desktop; hash, salt and attempt counters never do. */
export const GroupPasswordResultSchema = z.strictObject({
  result: z.enum(["ok", "wrong", "throttled"]),
  retryAfterMs: z.number().int().nonnegative().optional(),
});
export const GroupLockResultSchema = z.strictObject({ locked: z.literal(true) });
export const GroupSetHiddenResultSchema = z.strictObject({ updated: z.literal(true) });

export type GroupPasswordResult = z.infer<typeof GroupPasswordResultSchema>;
