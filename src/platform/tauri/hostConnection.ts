import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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

/** IPC only: device credentials, TLS, SSH and retry ownership remain native. */
export function createTauriHostConnection(
  machineId: string,
  options: { allowConnect?: boolean } = {},
): ManagedHostConnectionPort {
  IdentifierSchema.parse(machineId);
  return {
    async listen(listener) {
      const unlisten = await listen<unknown>("host-connection-event", ({ payload }) => {
        const parsed = nativeEnvelopeSchema.safeParse(payload);
        if (parsed.success && parsed.data.machineId === machineId)
          listener(parsed.data.event as ManagedHostEvent);
      });
      let released = false;
      return () => {
        if (!released) {
          released = true;
          unlisten();
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
