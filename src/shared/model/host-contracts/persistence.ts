import { z } from "zod";

/** Sanitized admission health; never contains database paths or raw storage errors. */
export const HostPersistenceStatusSchema = z.strictObject({
  state: z.enum(["ready", "temporarily-blocked", "recovering", "recovery-required"]),
  reason: z.enum(["busy", "full", "io", "corrupt", "worker"]).optional(),
});
export type HostPersistenceStatus = z.infer<typeof HostPersistenceStatusSchema>;
export const HostPersistenceParamsSchema = z.strictObject({});
