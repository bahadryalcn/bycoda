import { invoke } from "@tauri-apps/api/core";
import { currentWindowLabel, listenWindowAsync } from "./listenWindow";
import { z } from "zod";
import {
  BulkDescriptorSchema,
  ConnectionGenerationSchema,
  IdentifierSchema,
  JsonValueSchema,
  SubscriptionEventSchema,
  WS_LIMITS,
  parseHostRpcParams,
  hostRpcWireMethod,
  getHostRpcMethod,
} from "../../shared/model/host-contracts";
import type {
  ManagedHostConnectionPort,
  ManagedHostEvent,
} from "../../shared/lib/host-runtime/ports";
import { hostRpcHasEffect } from "../../shared/lib/host-runtime/requestPolicy";

const eventBase = { environmentId: IdentifierSchema, generation: ConnectionGenerationSchema };
const nativeEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...eventBase,
    kind: z.literal("state"),
    phase: z.enum(["connecting", "ready", "retry-wait", "blocked", "closed"]),
    category: z.string().nullable().optional(),
  }),
  z.strictObject({ ...eventBase, kind: z.literal("subscription"), event: SubscriptionEventSchema }),
]);
const nativeEnvelopeSchema = z.strictObject({
  machineId: IdentifierSchema,
  event: nativeEventSchema,
});
const replySchema = z.strictObject({
  generation: ConnectionGenerationSchema,
  result: JsonValueSchema,
});
const nativeFailureSchema = z
  .strictObject({
    code: z
      .string()
      .regex(/^RPC_WS_[A-Z_]+$/)
      .max(80),
    message: z.string().min(1).max(4096),
    generation: ConnectionGenerationSchema.nullable(),
    requestId: IdentifierSchema.nullable(),
    commandId: IdentifierSchema.nullable(),
    uncertain: z.boolean(),
    unsupported: z.boolean(),
  })
  .refine(
    (value) => !value.unsupported || (!value.uncertain && value.code === "RPC_WS_UNSUPPORTED"),
  );
type NativeFailure = z.infer<typeof nativeFailureSchema>;
export class NativeHostConnectionError extends Error {
  readonly code: string;
  readonly generation: number | null;
  readonly requestId: string | null;
  readonly commandId: string | null;
  readonly uncertain: boolean;
  readonly unsupported: boolean;
  constructor(value: NativeFailure) {
    super(`${value.code}: ${value.message}`);
    this.name = "NativeHostConnectionError";
    this.code = value.code;
    this.generation = value.generation;
    this.requestId = value.requestId;
    this.commandId = value.commandId;
    this.uncertain = value.uncertain;
    this.unsupported = value.unsupported;
  }
}
export function normalizeNativeHostFailure(
  error: unknown,
  commandId?: string,
  effectful = !!commandId,
): NativeHostConnectionError {
  const parsed = nativeFailureSchema.safeParse(error);
  if (
    parsed.success &&
    (!commandId || parsed.data.commandId === null || parsed.data.commandId === commandId)
  )
    return new NativeHostConnectionError({
      ...parsed.data,
      commandId: parsed.data.commandId ?? commandId ?? null,
    });
  return new NativeHostConnectionError({
    code: "RPC_WS_SCHEMA",
    message: "Native Host returned an invalid failure response.",
    generation: null,
    requestId: null,
    commandId: commandId ?? null,
    uncertain: effectful,
    unsupported: false,
  });
}
const responseTimeoutSchema = z.number().int().min(1).max(WS_LIMITS.maxResponseTimeoutMs);

const KNOWN_NATIVE_KINDS = new Set(["state", "subscription"]);

/**
 * Diagnostic only: reports the schema-level reason for one rejected native event.
 * Never logs the payload; the event kind is reduced to a fixed vocabulary.
 */
function reportRejectedNativeEvent(payload: unknown, reported: Set<string>): void {
  const kind =
    typeof payload === "object" &&
    payload !== null &&
    "event" in payload &&
    typeof payload.event === "object" &&
    payload.event !== null &&
    "kind" in payload.event &&
    typeof payload.event.kind === "string" &&
    KNOWN_NATIVE_KINDS.has(payload.event.kind)
      ? payload.event.kind
      : "unknown";
  if (reported.has(kind)) return;
  reported.add(kind);
  console.warn(
    `Host connection event rejected by schema (kind: ${kind}); later rejections of this kind are not logged.`,
  );
}

function routedMachineId(payload: unknown): string | undefined {
  return typeof payload === "object" &&
    payload !== null &&
    "machineId" in payload &&
    typeof payload.machineId === "string"
    ? payload.machineId
    : undefined;
}

type NativeEventListener = {
  listener: (event: ManagedHostEvent) => void;
  onRejected: (() => void) | undefined;
  reported: Set<string>;
};
type WindowRouter = {
  routes: Map<string, Set<NativeEventListener>>;
  ready: Promise<() => void>;
  unlisten?: () => void;
};
/** One native registration per window, however many machines are connected. */
const windowRouters = new Map<string, WindowRouter>();

/**
 * Identity is read cheaply first: an event for a machine nobody here listens to is never
 * deeply validated. A connected machine's event is validated strictly exactly once and then
 * delivered to that machine's listeners; a rejected one is never applied and only tells them
 * their view of the machine may be stale.
 */
function routeNativeEvent(routes: Map<string, Set<NativeEventListener>>, payload: unknown): void {
  const machineId = routedMachineId(payload);
  const entries = machineId === undefined ? undefined : routes.get(machineId);
  if (!entries?.size) return;
  const parsed = nativeEnvelopeSchema.safeParse(payload);
  const event =
    parsed.success && parsed.data.machineId === machineId
      ? (parsed.data.event as ManagedHostEvent)
      : undefined;
  for (const entry of [...entries]) {
    // One consumer's failure must not starve the other listeners of this machine.
    try {
      if (event) entry.listener(event);
      else {
        reportRejectedNativeEvent(payload, entry.reported);
        entry.onRejected?.();
      }
    } catch (error) {
      console.error("Host connection listener failed", error);
    }
  }
}

function windowRouter(label: string): WindowRouter {
  const existing = windowRouters.get(label);
  if (existing) return existing;
  const routes = new Map<string, Set<NativeEventListener>>();
  const router: WindowRouter = {
    routes,
    ready: listenWindowAsync<unknown>("host-connection-event", ({ payload }) => {
      // Native batches one tick of events into an ordered array; a lone envelope is still valid.
      if (Array.isArray(payload)) for (const envelope of payload) routeNativeEvent(routes, envelope);
      else routeNativeEvent(routes, payload);
    }),
  };
  windowRouters.set(label, router);
  router.ready.then(
    (unlisten) => {
      router.unlisten = unlisten;
    },
    () => {
      if (windowRouters.get(label) === router) windowRouters.delete(label);
    },
  );
  return router;
}

function removeNativeListener(
  label: string,
  router: WindowRouter,
  machineId: string,
  entry: NativeEventListener,
): void {
  const entries = router.routes.get(machineId);
  entries?.delete(entry);
  if (entries?.size === 0) router.routes.delete(machineId);
  if (router.routes.size > 0) return;
  if (windowRouters.get(label) === router) windowRouters.delete(label);
  router.unlisten?.();
}

/** IPC only: device credentials, TLS, SSH and retry ownership remain native. */
export function createTauriHostConnection(
  machineId: string,
  options: { allowConnect?: boolean } = {},
): ManagedHostConnectionPort {
  IdentifierSchema.parse(machineId);
  return {
    async listen(listener, onRejected) {
      const label = currentWindowLabel();
      const router = windowRouter(label);
      const entry: NativeEventListener = { listener, onRejected, reported: new Set<string>() };
      const entries = router.routes.get(machineId) ?? new Set<NativeEventListener>();
      entries.add(entry);
      router.routes.set(machineId, entries);
      try {
        await router.ready;
      } catch (error) {
        removeNativeListener(label, router, machineId, entry);
        throw error;
      }
      let released = false;
      return () => {
        if (!released) {
          released = true;
          removeNativeListener(label, router, machineId, entry);
        }
      };
    },
    async attach() {
      let result: unknown;
      try {
        result = await invoke<unknown>("host_connection_attach", { machineId, ...options });
      } catch (error) {
        throw normalizeNativeHostFailure(error);
      }
      if (typeof result !== "boolean") throw new Error("Invalid native Host attachment");
      return result;
    },
    async detach() {
      await invoke("host_connection_detach", { machineId });
    },
    async request(method, params, requestOptions) {
      method = hostRpcWireMethod(method);
      const parsed = parseHostRpcParams(method, params);
      const commandId =
        method === "commands.dispatch" ? IdentifierSchema.parse(parsed.commandId) : undefined;
      IdentifierSchema.parse(requestOptions.requestId);
      if (requestOptions.commandId !== undefined) IdentifierSchema.parse(requestOptions.commandId);
      if (requestOptions.commandId !== undefined && requestOptions.commandId !== commandId)
        throw new Error("Command ID does not match the request");
      if (requestOptions.responseTimeoutMs !== undefined)
        responseTimeoutSchema.parse(requestOptions.responseTimeoutMs);
      try {
        return replySchema.parse(
          await invoke<unknown>("host_connection_request", {
            machineId,
            method,
            params: parsed,
            ...requestOptions,
            ...options,
          }),
        );
      } catch (error) {
        throw normalizeNativeHostFailure(
          error,
          commandId,
          hostRpcHasEffect(method, getHostRpcMethod(method)!.kind),
        );
      }
    },
    async cancel(requestId) {
      IdentifierSchema.parse(requestId);
      await invoke("host_connection_cancel", { machineId, requestId });
    },
    async bulk(descriptor, requestOptions = {}) {
      const parsed = BulkDescriptorSchema.parse(descriptor);
      if (requestOptions.responseTimeoutMs !== undefined)
        responseTimeoutSchema.parse(requestOptions.responseTimeoutMs);
      try {
        return JsonValueSchema.parse(
          await invoke<unknown>("host_connection_bulk", {
            machineId,
            descriptor: parsed,
            ...requestOptions,
          }),
        );
      } catch (error) {
        throw normalizeNativeHostFailure(error);
      }
    },
  };
}
