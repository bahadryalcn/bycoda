import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AuthorityReferenceSchema,
  BulkDescriptorSchema,
  BulkResultSchema,
  ConnectionHelloParamsSchema,
  ConnectionHelloResultSchema,
  HOST_CONTRACT_FIXTURES,
  JsonValueSchema,
  RpcResponseSchema,
  RpcRequestSchema,
  SafeCounterSchema,
  StreamCursorSchema,
  SubscriptionEventSchema,
  WS_LIMITS,
  WS_SUBPROTOCOL,
  exportHostContractManifest,
  exportWireSchema,
  getHostRpcMethod,
  hostRpcWireMethod,
  parseHostRpcParams,
  parseRpcRequest,
} from "./index";

const request = (method: string, params: Record<string, unknown> = {}) => ({
  jsonrpc: "2.0",
  id: "window-a:request-1",
  method,
  params,
});

describe("Host WS method contracts", () => {
  it("preserves the original wire-name grammar with an explicit pre-dispatch alias", () => {
    const legacy = "goals.final-review.recheck", wire = hostRpcWireMethod(legacy);
    expect(wire).toBe("goals.finalReview.recheck");
    expect(hostRpcWireMethod("constructor")).toBe("constructor");
    expect(hostRpcWireMethod("unknown.operation")).toBe("unknown.operation");
    const params = { goalId: "goal", expectedUpdatedAt: 1 };
    expect(parseRpcRequest(request(wire, params)).method).toBe(wire);
    expect(() => parseRpcRequest(request(legacy, params))).toThrow();
    expect(getHostRpcMethod(legacy)).toBeUndefined();
    const manifest = exportHostContractManifest() as { aliases: Record<string, string>; methods: Record<string, unknown> };
    expect(manifest.aliases[legacy]).toBe(wire);
    expect(manifest.methods[legacy]).toBeUndefined();
    expect(getHostRpcMethod("goals.list")).toMatchObject({ retry: "never", cancellation: "wait-only", cost: "read" });
  });
  it("accepts only declared methods and validates their own closed params", () => {
    expect(parseRpcRequest(request("projects.list"))).toEqual(request("projects.list"));
    expect(
      parseRpcRequest(request("sessions.list", { projectId: "project-a", known: "😀etag" })).params,
    ).toEqual({ projectId: "project-a", known: "😀etag" });
    expect(() => parseRpcRequest(request("sessions.list"))).toThrow();
    expect(() => parseRpcRequest(request("projects.list", { ignored: true }))).toThrow();
    expect(() => parseRpcRequest({ ...request("projects.list"), unexpected: true })).toThrow();
    expect(() => parseRpcRequest(request("commands.dispatch", { type: "send" }))).toThrow();
    expect(() => parseHostRpcParams("constructor", {})).toThrow();
    expect(getHostRpcMethod("toString")).toBeUndefined();
    let nested: unknown = "leaf";
    for (let index = 0; index < 5_000; index++) nested = { child: nested };
    expect(() => parseRpcRequest(request("projects.list", { unrelated: nested }))).toThrow(
      /Unrecognized/,
    );
  });

  it("preserves known HTTP read parameters without enabling HTTP mutations", () => {
    expect(
      parseHostRpcParams("environment.describe", { supportedProviders: ["codex", "claude"] }),
    ).toEqual({ supportedProviders: ["codex", "claude"] });
    expect(
      parseHostRpcParams("sessions.page", {
        sessionId: "session-a",
        before: 0,
        revision: 7,
        preview: true,
        digests: false,
      }),
    ).toEqual({ sessionId: "session-a", before: 0, revision: 7, preview: true, digests: false });
    expect(parseHostRpcParams("commands.status", { commandId: "command-a" })).toEqual({
      commandId: "command-a",
    });
    expect(() =>
      parseHostRpcParams("sessions.page", { sessionId: "session-a", revision: "7" }),
    ).toThrow();
    expect(() =>
      parseHostRpcParams("environment.describe", { supportedProviders: undefined }),
    ).toThrow();
    expect(getHostRpcMethod("commands.dispatch")).toMatchObject({
      kind: "command",
      retry: "receipt-lookup",
      cancellation: "wait-only",
    });
    expect(getHostRpcMethod("environment.describe")).toMatchObject({
      scope: "device",
      kind: "query",
      retry: "safe-query",
      responseTimeoutMs: 12_000,
    });
  });

  it("negotiates explicit environment and versions without carrying credentials", () => {
    const hello = {
      environmentId: "environment-a",
      supportedWireVersions: [2],
      supportedSchemaVersions: [1],
      clientId: "client-a",
      clientKind: "desktop",
    };
    expect(ConnectionHelloParamsSchema.parse(hello)).toEqual(hello);
    expect(() => ConnectionHelloParamsSchema.parse({ ...hello, token: "secret" })).toThrow();
    expect(() =>
      ConnectionHelloParamsSchema.parse({ ...hello, supportedWireVersions: [1] }),
    ).toThrow();
    expect(() =>
      ConnectionHelloParamsSchema.parse({ ...hello, supportedWireVersions: [] }),
    ).toThrow();
    expect(
      ConnectionHelloResultSchema.parse({
        environmentId: "environment-a",
        wireVersion: 2,
        schemaVersion: 1,
        connectionId: "connection-a",
        capabilities: ["transport.ws.read.v2"],
        methods: ["projects.list"],
      }).methods,
    ).toEqual(["projects.list"]);
    expect(WS_SUBPROTOCOL).toBe("bycoda.rpc.v2");
  });

  it("keeps counters safe and authority distinct from connection identity", () => {
    expect(SafeCounterSchema.parse(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    for (const invalid of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])
      expect(SafeCounterSchema.safeParse(invalid).success).toBe(false);
    expect(
      AuthorityReferenceSchema.parse({
        environmentId: "environment-a",
        sessionId: "session-a",
        authorityGeneration: 4,
      }),
    ).toEqual({ environmentId: "environment-a", sessionId: "session-a", authorityGeneration: 4 });
    expect(() =>
      AuthorityReferenceSchema.parse({
        environmentId: "environment-a",
        sessionId: "session-a",
        connectionGeneration: 4,
      }),
    ).toThrow();
    expect(() =>
      StreamCursorSchema.parse({ epoch: "epoch-a", sequence: 4, authorityGeneration: 1 }),
    ).toThrow();
  });

  it("accepts only JSON results and notifications, not native values or mixed outcomes", () => {
    const response = {
      jsonrpc: "2.0",
      id: "request-a",
      result: { text: "Türkçe 😀", values: [null, 2, true] },
    };
    expect(RpcResponseSchema.parse(response)).toEqual(response);
    expect(() =>
      RpcResponseSchema.parse({ ...response, error: { code: -32603, message: "failed" } }),
    ).toThrow();
    for (const invalid of [
      undefined,
      Infinity,
      NaN,
      1n,
      new Date(),
      { nested: undefined },
      () => true,
    ])
      expect(JsonValueSchema.safeParse(invalid).success).toBe(false);
    const event = {
      jsonrpc: "2.0",
      method: "subscription.event",
      params: {
        subscriptionId: "subscription-a",
        streamId: "stream-a",
        cursor: { epoch: "epoch-a", sequence: 2 },
        kind: "delta",
        baseRevision: 3,
        revision: 4,
        data: { title: "新消息" },
      },
    };
    expect(SubscriptionEventSchema.parse(event)).toEqual(event);
    expect(() =>
      SubscriptionEventSchema.parse({
        ...event,
        params: { ...event.params, revision: Number.MAX_SAFE_INTEGER + 1 },
      }),
    ).toThrow();
  });
});

describe("native contract export", () => {
  it("runs the portable native conformance corpus against the canonical schemas", () => {
    const schemas = {
      request: RpcRequestSchema,
      response: RpcResponseSchema,
      streamCursor: StreamCursorSchema,
      authorityReference: AuthorityReferenceSchema,
      bulkDescriptor: BulkDescriptorSchema,
      bulkResult: BulkResultSchema,
    };
    for (const fixture of HOST_CONTRACT_FIXTURES) {
      const schema = schemas[fixture.schema as keyof typeof schemas];
      expect(schema, fixture.name).toBeDefined();
      expect(schema.safeParse(fixture.value).success, fixture.name).toBe(fixture.valid);
    }
  });

  it("exports deterministic draft 2020-12 schemas with closed envelopes", () => {
    const first = exportHostContractManifest() as {
      wireVersion: number;
      methods: Record<string, { params: Record<string, unknown> }>;
      schemas: Record<string, Record<string, unknown>>;
    };
    expect(JSON.stringify(first)).toBe(JSON.stringify(exportHostContractManifest()));
    expect(first.wireVersion).toBe(2);
    expect(first.schemas.request.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(first.schemas.request.oneOf).toBeInstanceOf(Array);
    for (const variant of first.schemas.request.oneOf as Record<string, unknown>[])
      expect(variant.additionalProperties).toBe(false);
    expect(first.methods["projects.list"].params.additionalProperties).toBe(false);
    expect(first.methods["commands.dispatch"].params.oneOf).toBeInstanceOf(Array);
    expect(Object.keys(first.methods)).toEqual(Object.keys(first.methods).sort());
    expect(WS_LIMITS.maxPendingRpc).toBe(64);
    expect(WS_LIMITS.maxMessageBytes).toBe(1_048_576);
  });

  it("rejects silent exporter losses, coercion and Unicode-incompatible string bounds", () => {
    const unsupported = [
      z.string().refine((value) => value.length > 0),
      z.coerce.number(),
      z.string().default("fallback"),
      z.string().transform((value) => value.trim()),
      z.object({ key: z.string() }),
      z.string().max(1),
      z.string().regex(/\p{L}+/u),
    ];
    for (const schema of unsupported) expect(() => exportWireSchema(schema)).toThrow();
    expect(
      exportWireSchema(z.strictObject({ text: z.string(), count: SafeCounterSchema })),
    ).toMatchObject({ type: "object", additionalProperties: false });
  });
});
