import { z } from "zod";
import { CLAUDE_WORKSPACE_GLOB } from "../sessionApprovalGrant";
import { IdentifierSchema, SafeCounterSchema, WIRE_UUID_V4_PATTERN } from "./schemas";

export const SessionApprovalGrantsParamsSchema = z.strictObject({
  sessionId: IdentifierSchema,
  authorityGeneration: SafeCounterSchema.min(1).optional(),
});

export const RevokeSessionApprovalGrantParamsSchema = SessionApprovalGrantsParamsSchema.extend({
  grantId: z.string().regex(WIRE_UUID_V4_PATTERN),
});

export const SessionApprovalGrantsResultSchema = z.array(
  z.strictObject({
    id: z.string().regex(WIRE_UUID_V4_PATTERN),
    scope: z.literal(CLAUDE_WORKSPACE_GLOB),
  }),
);
