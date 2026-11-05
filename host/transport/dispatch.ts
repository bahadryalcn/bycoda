import {
  getHostRpcMethod,
  parseHostRpcParams,
  type RpcError,
} from "../../src/shared/model/host-contracts";
import type {
  EnvironmentDescribeParams,
  EnvironmentReadOptions,
} from "../domains/environment/service";
import type { ProjectsReadOptions } from "../domains/projects/service";
import {
  HostDomainAuthorizationError,
  HostDomainOutcomeError,
  HostDomainRefusalError,
  type HostDomainContext,
} from "../domains/context";
import { hostRpcHasEffect } from "../../src/shared/model/host-contracts/effects";
import {
  REQUEST_EXPIRED_ERROR_CODE,
  REQUEST_EXPIRED_MESSAGE,
} from "../../src/shared/model/host-contracts/schemas";

export type HostDispatchErrorCode =
  | "unauthorized"
  | "wrong-environment"
  | "invalid-params"
  | "method-not-found"
  | "cancelled"
  | "overloaded"
  | "service-unavailable";

/** Safe transport-facing category. Diagnostic causes must not be sent to a client. */
export class HostDispatchError extends Error {
  constructor(
    readonly code: HostDispatchErrorCode,
    message: string,
    options?: ErrorOptions,
    readonly details?: RpcError["data"],
  ) {
    super(message, options);
    this.name = "HostDispatchError";
  }
}

export type HostReadPrincipal = {
  kind: "device" | "conversation" | "social" | "runtime-logs" | "peer";
  /** An opaque authenticated identity, never a bearer credential. */
  id: string;
};

export type HostDispatchContext = {
  environmentId: string;
  principal: HostReadPrincipal;
  /** Revalidate the current grant; a successful socket upgrade is insufficient. */
  authorized: () => boolean | Promise<boolean>;
  /** Grant check independent of socket attachment for already admitted work. */
  executionAuthorized?: () => boolean | Promise<boolean>;
  signal?: AbortSignal;
  exposeQueueAttachments?: HostDomainContext["exposeQueueAttachments"];
  retargetTask?: HostDomainContext["retargetTask"];
  devServerAccess?: HostDomainContext["devServerAccess"];
  workspaceOwner?: HostDomainContext["workspaceOwner"];
  nativeServices?: HostDomainContext["nativeServices"];
  nativeDevices?: HostDomainContext["nativeDevices"];
  nativeDelivery?: HostDomainContext["nativeDelivery"];
  retainResultAuthority?: HostDomainContext["retainResultAuthority"];
  /** Retains backend admission even when a client stops waiting for legacy I/O. */
  trackWork?: <T>(action: () => Promise<T>) => Promise<T>;
};

export type HostServices = {
  environmentId: string;
  environment: {
    describe: (
      params: EnvironmentDescribeParams,
      options?: EnvironmentReadOptions,
    ) => Promise<unknown>;
  };
  projects: {
    list: (options?: ProjectsReadOptions, context?: HostDomainContext) => Promise<unknown>;
  };
  operations?: Readonly<
    Record<
      string,
      (params: Record<string, unknown>, context: HostDomainContext) => Promise<unknown>
    >
  >;
};

const implementedMethods = new Set(["environment.describe", "projects.list"]);

function cancelled(): HostDispatchError {
  return new HostDispatchError("cancelled", "Host read was cancelled.");
}

function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelled();
}

/** Release a cancelled request even if a legacy read cannot stop its underlying I/O. */
function waitForRead<T>(action: () => T | PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  assertNotCancelled(signal);
  const result = Promise.resolve().then(() => {
    assertNotCancelled(signal);
    return action();
  });
  if (!signal) return result;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(cancelled());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    void result.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) reject(cancelled());
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(signal.aborted ? cancelled() : error);
      },
    );
  });
}

async function authorize(context: HostDispatchContext, environmentId: string): Promise<void> {
  assertNotCancelled(context.signal);
  if (context.principal.kind !== "device" || !context.principal.id)
    throw new HostDispatchError("unauthorized", "A paired device grant is required.");
  if (context.environmentId !== environmentId)
    throw new HostDispatchError(
      "wrong-environment",
      "Host identity changed; reconnect explicitly.",
    );
  let permitted = false;
  try {
    permitted = (await waitForRead(context.authorized, context.signal)) === true;
  } catch (cause) {
    assertNotCancelled(context.signal);
    if (
      cause instanceof HostDispatchError &&
      (cause.code === "overloaded" || cause.code === "service-unavailable")
    )
      throw cause;
    throw new HostDispatchError("unauthorized", "Device authorization could not be verified.", {
      cause,
    });
  }
  if (!permitted)
    throw new HostDispatchError("unauthorized", "Device authorization is invalid or revoked.");
  assertNotCancelled(context.signal);
}

/**
 * Explicit domain routes. Schema inventory never enables an unimplemented
 * service, scoped tool token, provider command or legacy compatibility fallback.
 */
export function createHostDispatcher(services: HostServices) {
  const operations = new Map(Object.entries(services.operations ?? {}));
  for (const method of operations.keys())
    if (
      implementedMethods.has(method) ||
      !getHostRpcMethod(method) ||
      getHostRpcMethod(method)!.scope !== "device"
    )
      throw new Error(`Invalid Host domain route: ${method}.`);
  const methods = [...implementedMethods, ...operations.keys()];
  return {
    methods,
    supports(method: string): boolean {
      return methods.includes(method);
    },
    async dispatch(
      method: string,
      rawParams: unknown,
      context: HostDispatchContext,
    ): Promise<unknown> {
      await authorize(context, services.environmentId);
      const definition = getHostRpcMethod(method);
      if (!methods.includes(method) || !definition || definition.scope !== "device")
        throw new HostDispatchError("method-not-found", "Host read method is not available.");
      let params;
      try {
        params = parseHostRpcParams(method, rawParams);
      } catch {
        throw new HostDispatchError("invalid-params", "Host read parameters are invalid.");
      }
      const cancellable = definition.cancellation === "query";
      const options = { signal: cancellable ? context.signal : undefined };
      const domainContext: HostDomainContext = {
        principalId: context.principal.id,
        authorized: async () =>
          (await (
            cancellable ? context.authorized : (context.executionAuthorized ?? context.authorized)
          )()) === true,
        signal: options.signal,
        closing: () => !!options.signal?.aborted,
        exposeQueueAttachments: context.exposeQueueAttachments,
        retargetTask: context.retargetTask,
        devServerAccess: context.devServerAccess,
        workspaceOwner: context.workspaceOwner,
        nativeServices: context.nativeServices,
        nativeDevices: context.nativeDevices,
        nativeDelivery: context.nativeDelivery,
        retainResultAuthority: context.retainResultAuthority,
      };
      try {
        const read = () =>
          operations.has(method)
            ? operations.get(method)!(params, domainContext)
            : method === "environment.describe"
              ? services.environment.describe(params, options)
              : services.projects.list(options, domainContext);
        const result = await waitForRead(
          () => (context.trackWork ? context.trackWork(read) : read()),
          options.signal,
        );
        // A revoke during any awaited store/provider read must prevent disclosure.
        await authorize(context, services.environmentId);
        return result;
      } catch (cause) {
        assertNotCancelled(context.signal);
        if (cause instanceof HostDispatchError) throw cause;
        if (cause instanceof HostDomainOutcomeError) {
          await authorize(context, services.environmentId);
          throw new HostDispatchError(
            "service-unavailable",
            cause.message,
            { cause },
            {
              category: "unavailable",
              retryable: false,
              delivery: cause.delivery,
            },
          );
        }
        if (cause instanceof HostDomainAuthorizationError)
          throw new HostDispatchError(
            "unauthorized",
            "Device authorization is invalid or revoked.",
            { cause },
          );
        // A refusal raised before execution: nothing ran, so delivery is known and
        // clients keep its message and code. The category ("conflict" or
        // "validation") tells them whether to wait or fix the request; the numeric
        // RPC code stays invalid-params for both.
        if (cause instanceof HostDomainRefusalError)
          throw new HostDispatchError(
            "invalid-params",
            cause.message,
            { cause },
            {
              category: cause.category,
              retryable: cause.retryable,
              delivery: "not-sent",
              code: cause.code,
              ...(definition.kind === "command" && typeof params.commandId === "string"
                ? { commandId: params.commandId }
                : {}),
            },
          );
        // Admission refused an expired request id: nothing ran, so delivery is known.
        if (
          typeof cause === "object" &&
          cause !== null &&
          "code" in cause &&
          cause.code === REQUEST_EXPIRED_ERROR_CODE
        )
          throw new HostDispatchError(
            "invalid-params",
            REQUEST_EXPIRED_MESSAGE,
            { cause },
            {
              category: "validation",
              retryable: false,
              delivery: "not-sent",
              code: REQUEST_EXPIRED_ERROR_CODE,
              ...(typeof params.commandId === "string" ? { commandId: params.commandId } : {}),
            },
          );
        if (
          method === "commands.dispatch" &&
          (params.type === "cancel" || params.type === "stopItem") &&
          typeof cause === "object" &&
          cause !== null &&
          "code" in cause &&
          cause.code === "HOST_CONTROL_RECEIPT_UNCONFIRMED" &&
          "controlApplied" in cause &&
          cause.controlApplied === true
        ) {
          throw new HostDispatchError(
            "service-unavailable",
            "Live control was sent, but its receipt could not be saved. Inspect the current run before retrying.",
            { cause },
            {
              category: "unavailable",
              retryable: false,
              commandId: String(params.commandId),
              delivery: "unknown",
            },
          );
        }
        if (hostRpcHasEffect(method, definition.kind))
          throw new HostDispatchError(
            "service-unavailable",
            "The Host operation could not be confirmed. Refresh its state before retrying.",
            { cause },
            {
              category: "unavailable",
              retryable: false,
              delivery: "unknown",
              ...(definition.kind === "command" && typeof params.commandId === "string"
                ? { commandId: params.commandId }
                : {}),
            },
          );
        throw new HostDispatchError("service-unavailable", "Host read could not be completed.", {
          cause,
        });
      }
    },
  };
}

export const createHostReadDispatcher = createHostDispatcher;
export type HostReadDispatchContext = HostDispatchContext;
export type HostReadServices = HostServices;
