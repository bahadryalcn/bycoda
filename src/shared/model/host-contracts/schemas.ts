import { z } from "zod";
import { HOST_SCHEMA_VERSION, WS_WIRE_VERSION, WS_LIMITS } from "./policy";

export type JsonPrimitive = null | boolean | string | number;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Open JSON is limited to explicitly declared payload/result boundaries. */
export const JsonValueSchema: z.ZodType<JsonValue> = z.json();
export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);
export const SafeCounterSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const SignedSafeIntegerSchema = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);

/** ASCII protocol identifiers give JS and native validators identical bounds. */
// `(?![\s\S])` means strict end-of-input; JS `$` also accepts a final newline.
export const WIRE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}(?![\s\S])/;
export const WIRE_METHOD_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*){1,7}(?![\s\S])/;
export const WIRE_CAPABILITY_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+){1,7}(?![\s\S])/;
export const WIRE_UUID_V4_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/;
export const IdentifierSchema = z.string().regex(WIRE_IDENTIFIER_PATTERN);
export const MethodNameSchema = z.string().regex(WIRE_METHOD_PATTERN);
export const CapabilityNameSchema = z.string().regex(WIRE_CAPABILITY_PATTERN);

export const EnvironmentIdentitySchema = z.strictObject({ environmentId: IdentifierSchema });
export type EnvironmentIdentity = z.infer<typeof EnvironmentIdentitySchema>;
export const SessionIdentitySchema = EnvironmentIdentitySchema.extend({
  sessionId: IdentifierSchema,
});
export type SessionIdentity = z.infer<typeof SessionIdentitySchema>;
export const AuthorityReferenceSchema = SessionIdentitySchema.extend({
  authorityGeneration: SafeCounterSchema,
});
export type AuthorityReference = z.infer<typeof AuthorityReferenceSchema>;
export const ConnectionGenerationSchema = SafeCounterSchema;
export type ConnectionGeneration = z.infer<typeof ConnectionGenerationSchema>;
export const StreamCursorSchema = z.strictObject({
  epoch: IdentifierSchema,
  sequence: SafeCounterSchema,
});
export type StreamCursor = z.infer<typeof StreamCursorSchema>;

export const ConnectionHelloParamsSchema = z.strictObject({
  environmentId: IdentifierSchema,
  supportedWireVersions: z.array(z.literal(WS_WIRE_VERSION)).min(1).max(8),
  supportedSchemaVersions: z.array(z.literal(HOST_SCHEMA_VERSION)).min(1).max(8),
  clientId: IdentifierSchema,
  clientKind: z.enum(["desktop", "mobile", "web"]),
});
export type ConnectionHelloParams = z.infer<typeof ConnectionHelloParamsSchema>;
export const ConnectionHelloResultSchema = z.strictObject({
  environmentId: IdentifierSchema,
  wireVersion: z.literal(WS_WIRE_VERSION),
  schemaVersion: z.literal(HOST_SCHEMA_VERSION),
  connectionId: IdentifierSchema,
  capabilities: z.array(CapabilityNameSchema).max(256),
  methods: z.array(MethodNameSchema).max(256),
});
export type ConnectionHelloResult = z.infer<typeof ConnectionHelloResultSchema>;
export const ConnectionProbeParamsSchema = z.strictObject({});
export const ConnectionProbeResultSchema = z.strictObject({
  environmentId: IdentifierSchema,
  connectionId: IdentifierSchema,
});

export const SubscriptionTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("environment") }),
  z.strictObject({ kind: z.literal("project"), projectId: IdentifierSchema }),
  z.strictObject({ kind: z.literal("session"), sessionId: IdentifierSchema }),
]);
export const SubscriptionOpenParamsSchema = z.strictObject({
  subscriptionId: IdentifierSchema,
  target: SubscriptionTargetSchema,
  cursor: StreamCursorSchema.optional(),
});
export const SubscriptionOpenResultSchema = z.strictObject({
  subscriptionId: IdentifierSchema,
  streamId: IdentifierSchema,
});
export const SubscriptionAckParamsSchema = z.strictObject({
  subscriptionId: IdentifierSchema,
  cursor: StreamCursorSchema,
});
export const SubscriptionCloseParamsSchema = z.strictObject({ subscriptionId: IdentifierSchema });
export const RequestCancelParamsSchema = z.strictObject({ requestId: IdentifierSchema });
export const ControlAcceptedSchema = z.strictObject({ accepted: z.boolean() });

/** Machine code for a request id older than the Host replay horizon: it was not run. */
export const REQUEST_EXPIRED_ERROR_CODE = "REQUEST_EXPIRED" as const;
export const REQUEST_EXPIRED_MESSAGE =
  "This request is older than 30 days and was not run. Check whether it already happened and send it again.";

/**
 * Machine codes for a Host refusal made before any effect started. Each one is
 * sent with delivery "not-sent": nothing ran, so the same command may be sent
 * again once its category and `retryable` flag allow it. Messages stay stable.
 */
export const HOST_REFUSAL_ERROR_CODES = [
  "LEASE_HELD",
  "QUEUE_DRAIN_HELD",
  "QUEUE_LEASE_CHANGED",
  "QUEUE_CHANGED",
  "QUEUE_FULL",
  "QUEUE_ROW_CHANGED",
  "QUEUE_AUTHORITY",
  "COMMAND_BUSY",
  "COMMAND_INVALID",
  "CONTEXT_CHANGED",
  "NATIVE_ADMISSION_UNENROLLED",
  "PROJECT_FOLDER_MISSING",
] as const;
export type HostRefusalErrorCode = (typeof HOST_REFUSAL_ERROR_CODES)[number];

export const SafeTypedErrorSchema = z.strictObject({
  category: z.enum([
    "validation",
    "authentication",
    "identity",
    "schema",
    "overload",
    "deadline",
    "cancelled",
    "unavailable",
    "conflict",
    "internal",
  ]),
  retryable: z.boolean().optional(),
  operationId: IdentifierSchema.optional(),
  commandId: IdentifierSchema.optional(),
  delivery: z.enum(["not-sent", "unknown", "accepted"]).optional(),
  code: z.enum([REQUEST_EXPIRED_ERROR_CODE, ...HOST_REFUSAL_ERROR_CODES]).optional(),
});
export const RpcErrorSchema = z.strictObject({
  code: SignedSafeIntegerSchema,
  message: z.string(),
  data: SafeTypedErrorSchema.optional(),
});
export type RpcError = z.infer<typeof RpcErrorSchema>;
export const RpcSuccessResponseSchema = z.strictObject({
  jsonrpc: z.literal("2.0"),
  id: IdentifierSchema,
  result: JsonValueSchema,
});
export const RpcErrorResponseSchema = z.strictObject({
  jsonrpc: z.literal("2.0"),
  id: IdentifierSchema.nullable(),
  error: RpcErrorSchema,
});
export const RpcResponseSchema = z.union([RpcSuccessResponseSchema, RpcErrorResponseSchema]);
export type RpcResponse = z.infer<typeof RpcResponseSchema>;

/** A protected HTTP byte transfer; no credential or caller-controlled URL. */
export const WIRE_SHA256_PATTERN = /^[a-f0-9]{64}(?![\s\S])/;
export const BulkDescriptorSchema = z.strictObject({
  kind: z.literal("bulk"),
  transferId: IdentifierSchema,
  environmentId: IdentifierSchema,
  totalBytes: SafeCounterSchema,
  chunkBytes: SafeCounterSchema.min(1).max(WS_LIMITS.streamChunkBytes),
  sha256: z.string().regex(WIRE_SHA256_PATTERN),
  expiresAt: SafeCounterSchema,
});
export type BulkDescriptor = z.infer<typeof BulkDescriptorSchema>;
/** Unary result indirection; resolve and hash-check bytes before domain parsing. */
export const BulkResultSchema = z.strictObject({ $bulk: BulkDescriptorSchema });
export type BulkResult = z.infer<typeof BulkResultSchema>;

export const SubscriptionEventSchema = z.strictObject({
  jsonrpc: z.literal("2.0"),
  method: z.literal("subscription.event"),
  params: z.strictObject({
    subscriptionId: IdentifierSchema,
    streamId: IdentifierSchema,
    cursor: StreamCursorSchema,
    baseRevision: SafeCounterSchema.optional(),
    revision: SafeCounterSchema.optional(),
    kind: z.enum(["snapshot", "delta", "resync-required", "closed"]),
    // Domain payloads remain JSON. When data.kind is "bulk", the producer and
    // consumer validate BulkDescriptorSchema before using the protected transfer.
    data: JsonValueSchema.optional(),
  }),
});
export type SubscriptionEvent = z.infer<typeof SubscriptionEventSchema>;
