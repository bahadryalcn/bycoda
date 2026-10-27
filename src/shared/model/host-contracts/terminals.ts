import { z } from "zod";
import { IdentifierSchema, SafeCounterSchema, SignedSafeIntegerSchema } from "./schemas";

/** Pipe shells only. PTY/SSH control leases retain their separate contracts. */
export const HostTerminalSchema = z.strictObject({
  id: IdentifierSchema,
  projectId: IdentifierSchema,
  name: z.string(),
  cwd: z.string(),
  shell: z.string(),
  transport: z.literal("pipe"),
  state: z.enum(["running", "exited"]),
  createdAt: SafeCounterSchema,
  exitCode: SignedSafeIntegerSchema.nullable(),
});
export const HostTerminalListSchema = z.strictObject({
  terminals: z.array(HostTerminalSchema).max(32),
  writable: z.boolean(),
  profiles: z.array(z.strictObject({ id: z.string(), name: z.string() })),
});
export const HostTerminalReadSchema = z.strictObject({
  terminal: HostTerminalSchema,
  output: z.string(),
  cursor: SafeCounterSchema,
  truncated: z.boolean(),
  hasMore: z.boolean(),
});
export const TerminalsListParamsSchema = z.strictObject({ projectId: IdentifierSchema });
export const TerminalsCreateParamsSchema = z.strictObject({
  projectId: IdentifierSchema,
  // The process owner enforces its legacy request ID format and retention policy.
  requestId: z.string(),
  name: z.string().optional(),
  cwd: z.string().optional(),
  profileId: z.string().optional(),
});
export const TerminalsReadParamsSchema = z.strictObject({
  projectId: IdentifierSchema,
  id: IdentifierSchema,
  after: SafeCounterSchema.optional(),
  limit: SafeCounterSchema.min(1).max(65536).optional(),
});
export const TerminalsWriteParamsSchema = z.strictObject({
  projectId: IdentifierSchema,
  id: IdentifierSchema,
  // UTF-8 byte limits remain in the shell owner, shared with legacy HTTP.
  data: z.string(),
});
export const TerminalsControlParamsSchema = z.strictObject({
  projectId: IdentifierSchema,
  id: IdentifierSchema,
});

export type HostTerminal = z.infer<typeof HostTerminalSchema>;
export type HostTerminalList = z.infer<typeof HostTerminalListSchema>;
export type HostTerminalRead = z.infer<typeof HostTerminalReadSchema>;
export type HostTerminalCreate = z.infer<typeof TerminalsCreateParamsSchema>;
export type HostTerminalProfile = HostTerminalList["profiles"][number];
