import { z } from "zod";
import type { HostRpcMethodDefinition } from "./methods";

// The published manifest allows only length checks, so the wire schema bounds the reference by
// length and the handler applies the strict pattern below. The contract never carries a value.
const secretRef = z.string().min(1).max(100);
const StrictSecretRefSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

export const OwnerSecretViewSchema = z.strictObject({
  secretRef,
  projectId: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  purpose: z.string().max(1000),
  createdAt: z.number().int(),
  expiresAt: z.number().int().nullable(),
  materialized: z.boolean(),
});
export type OwnerSecretViewDto = z.infer<typeof OwnerSecretViewSchema>;

export const SecretsOwnerRevokeParamsSchema = z.strictObject({ secretRef: StrictSecretRefSchema });
const RevokeWireParamsSchema = z.strictObject({ secretRef });

/** Owner-only inventory of the secrets agents asked for; revoking deletes the saved value. */
export const SECRETS_OWNER_RPC = {
  "secrets.owner.list": {
    params: z.strictObject({}),
    result: z.strictObject({ secrets: z.array(OwnerSecretViewSchema).max(10000) }),
    query: true,
  },
  "secrets.owner.revoke": {
    params: RevokeWireParamsSchema,
    result: z.strictObject({ revoked: z.literal(true) }),
    query: false,
  },
} as const;

export type SecretsOwnerMethod = keyof typeof SECRETS_OWNER_RPC;

/** The caller passes its workflow builder in, as `decisionModelsMethods` does. */
export function secretsOwnerMethods(
  workflow: (
    requiredCapability: string,
    params: z.ZodType,
    result: z.ZodType,
    query?: boolean,
  ) => HostRpcMethodDefinition,
) {
  const operation = (method: SecretsOwnerMethod): HostRpcMethodDefinition => {
    const schema = SECRETS_OWNER_RPC[method];
    return workflow("secrets.owner.v1", schema.params, schema.result, schema.query);
  };
  return {
    "secrets.owner.list": operation("secrets.owner.list"),
    "secrets.owner.revoke": operation("secrets.owner.revoke"),
  };
}
