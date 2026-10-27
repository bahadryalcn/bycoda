import { z } from "zod";
import { HOST_RPC_METHODS, RpcRequestSchema } from "./methods";
import { HOST_RPC_METHOD_ALIASES } from "./aliases";
import { CommandDispatchParamsSchema, CommandReceiptSchema } from "./session-commands";
import { MobileTlsBootstrapSchema } from "./mobile-tls";
import { HostPersistenceStatusSchema } from "./persistence";
import {
  NativeFenceEvidenceSchema,
  HostAuthorityDecisionSchema,
  NativeQuiesceCancellationSchema,
} from "./authority";
import {
  SessionSyncResponseSchema,
  SessionViewSchema,
  SessionSummarySchema,
} from "./session-reads";
import {
  HOST_SCHEMA_VERSION,
  WS_LIMITS,
  WS_RETRY_POLICY,
  WS_SUBPROTOCOL,
  WS_WIRE_VERSION,
} from "./policy";
import {
  AuthorityReferenceSchema,
  ConnectionGenerationSchema,
  RpcResponseSchema,
  StreamCursorSchema,
  SubscriptionEventSchema,
  WIRE_CAPABILITY_PATTERN,
  WIRE_IDENTIFIER_PATTERN,
  WIRE_METHOD_PATTERN,
  WIRE_SHA256_PATTERN,
  BulkDescriptorSchema,
  BulkResultSchema,
} from "./schemas";

const compareKeys = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Stable key order is shared by build tooling and native artifact drift checks. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => compareKeys(a, b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  return value;
}

/** Zod's exporter alone ignores custom refinements and permits coercion/defaults. */
function assertWireSubset(value: z.ZodType, visited = new Set<z.ZodType>()): void {
  if (visited.has(value)) return;
  visited.add(value);
  // This documented Zod 4 core shape is pinned and covered by export fixtures.
  const definition = value._zod.def as unknown as Record<string, unknown>;
  const type = definition.type;
  if (definition.coerce) throw new Error("Wire schemas cannot coerce input.");
  if (
    ![
      "null",
      "boolean",
      "string",
      "number",
      "literal",
      "enum",
      "array",
      "object",
      "record",
      "union",
      "lazy",
      "optional",
      "nullable",
      "never",
    ].includes(String(type))
  )
    throw new Error(`Unsupported wire schema type: ${String(type)}.`);
  for (const check of (definition.checks ?? []) as { _zod: { def: Record<string, unknown> } }[]) {
    const rule = check._zod.def;
    const numeric =
      type === "number" &&
      ((rule.check === "number_format" && rule.format === "safeint") ||
        (["greater_than", "less_than"].includes(String(rule.check)) &&
          typeof rule.value === "number" &&
          Number.isFinite(rule.value)));
    const arrayLength =
      type === "array" && ["min_length", "max_length"].includes(String(rule.check));
    const pattern = rule.pattern;
    const identifier =
      type === "string" &&
      rule.check === "string_format" &&
      rule.format === "regex" &&
      pattern instanceof RegExp &&
      !pattern.flags &&
      [
        WIRE_IDENTIFIER_PATTERN.source,
        WIRE_METHOD_PATTERN.source,
        WIRE_CAPABILITY_PATTERN.source,
        WIRE_SHA256_PATTERN.source,
      ].includes(pattern.source);
    if (!numeric && !arrayLength && !identifier)
      throw new Error(`Unsupported wire schema check: ${String(rule.check)}.`);
  }
  const visit = (child: unknown) => {
    if (child && typeof child === "object" && "_zod" in child)
      assertWireSubset(child as z.ZodType, visited);
  };
  if (type === "object") {
    if ((definition.catchall as z.ZodType | undefined)?._zod.def.type !== "never")
      throw new Error("Wire object schemas must reject unknown fields.");
    Object.values(definition.shape as Record<string, z.ZodType>).forEach(visit);
  } else if (type === "union") (definition.options as z.ZodType[]).forEach(visit);
  else if (type === "lazy") visit((definition.getter as () => z.ZodType)());
  else for (const key of ["element", "keyType", "valueType", "innerType"]) visit(definition[key]);
  if (type === "literal")
    for (const literal of definition.values as unknown[])
      if (
        (literal !== null && !["string", "boolean", "number"].includes(typeof literal)) ||
        (typeof literal === "number" && !Number.isFinite(literal))
      )
        throw new Error("Wire literal is not JSON representable.");
}

/** Strict representable subset, independently validated before Zod conversion. */
export function exportWireSchema(value: z.ZodType) {
  assertWireSubset(value);
  return canonicalize(z.toJSONSchema(value, { target: "draft-2020-12", unrepresentable: "throw" }));
}

export function exportHostContractManifest() {
  const schema = exportWireSchema;
  const methods = Object.fromEntries(
    Object.entries(HOST_RPC_METHODS)
      .sort(([a], [b]) => compareKeys(a, b))
      .map(([name, definition]) => [
        name,
        {
          kind: definition.kind,
          scope: definition.scope,
          retry: definition.retry,
          cancellation: definition.cancellation,
          cost: definition.cost,
          requiredCapability: definition.requiredCapability ?? null,
          controlTypes: definition.controlTypes ?? [],
          responseTimeoutMs: definition.responseTimeoutMs,
          admissionTimeoutMs: definition.admissionTimeoutMs,
          params: schema(definition.paramsSchema),
          result: schema(definition.resultSchema),
        },
      ]),
  );
  return canonicalize({
    format: "bycoda.host-contract-manifest",
    wireVersion: WS_WIRE_VERSION,
    schemaVersion: HOST_SCHEMA_VERSION,
    subprotocol: WS_SUBPROTOCOL,
    limits: WS_LIMITS,
    retryPolicy: WS_RETRY_POLICY,
    methods,
    aliases: HOST_RPC_METHOD_ALIASES,
    schemas: {
      request: schema(RpcRequestSchema),
      authorityReference: schema(AuthorityReferenceSchema),
      connectionGeneration: schema(ConnectionGenerationSchema),
      response: schema(RpcResponseSchema),
      streamCursor: schema(StreamCursorSchema),
      subscriptionEvent: schema(SubscriptionEventSchema),
      command: schema(CommandDispatchParamsSchema),
      commandReceipt: schema(CommandReceiptSchema),
      sessionView: schema(SessionViewSchema),
      sessionSummary: schema(SessionSummarySchema),
      sessionSyncResponse: schema(SessionSyncResponseSchema),
      bulkDescriptor: schema(BulkDescriptorSchema),
      bulkResult: schema(BulkResultSchema),
      mobileTlsBootstrap: schema(MobileTlsBootstrapSchema),
      persistenceStatus: schema(HostPersistenceStatusSchema),
      nativeFenceEvidence: schema(NativeFenceEvidenceSchema),
      hostAuthorityDecision: schema(HostAuthorityDecisionSchema),
      nativeQuiesceCancellation: schema(NativeQuiesceCancellationSchema),
    },
  });
}
