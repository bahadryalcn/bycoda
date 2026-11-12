import { z } from "zod";
import { SessionProviderSchema } from "./session-commands";

export const ModelsListParamsSchema = z.strictObject({
  projectId: z.string().optional(),
  progressive: z.boolean().optional(),
  refresh: z.boolean().optional(),
});
const choice = z.strictObject({ value: z.string(), label: z.string() });
export const CatalogModelSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  // Legacy discovery adapters may identify the harness only by the catalog key.
  harness: SessionProviderSchema.optional(),
  nativeId: z.string().optional(),
  aliasTarget: z.string().optional(),
  provider: z.strictObject({ id: z.string(), name: z.string() }).optional(),
  settings: z
    .array(
      z.strictObject({
        id: z.string(),
        label: z.string(),
        kind: z.enum(["select", "toggle"]),
        value: z.string(),
        options: z.array(choice),
        description: z.string().optional(),
      }),
    )
    .optional(),
  contextWindow: z.number().optional(),
});
const account = z.strictObject({
  isDefault: z.boolean().optional(),
  id: z.string(),
  label: z.string(),
  color: z.string().optional(),
  kind: z.enum(["personal", "work"]).optional(),
  derivedKind: z.enum(["personal", "work"]).optional(),
});
export const HostModelAccountsSchema = z.strictObject({
  codex: z.array(account).optional(),
  claude: z.array(account).optional(),
});
export const ModelsListResultSchema = z.strictObject({
  models: z.record(z.string(), z.array(CatalogModelSchema)),
  errors: z.record(z.string(), z.string()),
  pending: z.array(SessionProviderSchema).optional(),
  accounts: HostModelAccountsSchema.optional(),
});
