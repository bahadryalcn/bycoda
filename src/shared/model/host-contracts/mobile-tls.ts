import { z } from "zod";
import { IdentifierSchema, SafeCounterSchema } from "./schemas";

/** Public trust only. Endpoint/SAN/CA pin verification belongs to the native adapter. */
export const MobileTlsBootstrapSchema = z.strictObject({
  version: z.literal(1),
  environmentId: IdentifierSchema,
  caGeneration: SafeCounterSchema.min(1),
  caCertificatePem: z.string(),
  caSpkiPin: z.string(),
  endpoint: z.string(),
  bulkBaseUrl: z.string(),
});
export type MobileTlsBootstrap = z.infer<typeof MobileTlsBootstrapSchema>;
