import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { TextDecoder } from "node:util";
import { isAbsolute } from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { IdentifierSchema } from "../../src/shared/model/host-contracts/schemas";
import {
  NativeSourceRegistry,
  NativeSourceRegistryError,
  NativeSourceRegistrationSchema,
  NativeSourceReferenceSchema,
  NativeSourceLookupSchema,
  NativeSourceProjectionScopeSchema,
} from "./source-registry";

export const NATIVE_AUTHORITY_BOOTSTRAP_PATH = "/native-authority/bootstrap";
const RequestSchema = z.discriminatedUnion("action", [
  z.object({ version: z.literal(1), action: z.literal("describe") }).strict(),
  NativeSourceRegistrationSchema.extend({
    version: z.literal(1),
    action: z.literal("register-source"),
  }).strict(),
  NativeSourceReferenceSchema.extend({
    version: z.literal(1),
    action: z.literal("source-status"),
  }).strict(),
  NativeSourceReferenceSchema.extend({
    version: z.literal(1),
    action: z.literal("source-projection-observe"),
    ...NativeSourceProjectionScopeSchema.shape,
  }).strict(),
  NativeSourceReferenceSchema.extend({
    version: z.literal(1),
    action: z.literal("unregister-source"),
  }).strict(),
  NativeSourceLookupSchema.extend({
    version: z.literal(1),
    action: z.literal("lookup-source"),
  }).strict(),
]);
const MAX_BODY_BYTES = 2048;
type Handler = ((request: IncomingMessage, response: ServerResponse) => void) & {
  close(): Promise<void>;
};

/** Private local bootstrap only. Administrative authentication is not actor proof. */
export function createNativeAuthorityBootstrap(options: {
  secret: string;
  environmentId: string;
  maxPending?: number;
  bodyTimeoutMs?: number;
  /** Exclusive ownership is transferred to this handler until actual cleanup. */
  registry?: NativeSourceRegistry;
  provisioningLauncher?: { nodeExecutable: string; entryPath: string };
}): Handler {
  const environmentId = IdentifierSchema.parse(options.environmentId);
  const expected = Buffer.from(`Bearer ${options.secret}`, "utf8");
  const maximum = options.maxPending ?? 8;
  const timeoutMs = options.bodyTimeoutMs ?? 2_000;
  const registry = options.registry;
  const provisioningLauncher = options.provisioningLauncher
    ? Object.freeze({ ...options.provisioningLauncher })
    : undefined;
  if (registry && registry.environmentId !== environmentId)
    throw new Error("Native source registry environment changed");
  if (
    provisioningLauncher &&
    (typeof provisioningLauncher.nodeExecutable !== "string" ||
      typeof provisioningLauncher.entryPath !== "string" ||
      !isAbsolute(provisioningLauncher.nodeExecutable) ||
      !isAbsolute(provisioningLauncher.entryPath) ||
      Buffer.byteLength(provisioningLauncher.nodeExecutable) +
        Buffer.byteLength(provisioningLauncher.entryPath) >
        6144)
  )
    throw new Error("Invalid native provisioning launcher configuration");
  if (
    Buffer.byteLength(options.secret) < 32 ||
    Buffer.byteLength(options.secret) > 128 ||
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    maximum > 32 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30_000
  )
    throw new Error("Invalid native authority bootstrap configuration");
  const pending = new Set<() => void>();
  const owned = new Set<Promise<void>>();
  let closed = false;
  let closing: Promise<void> | undefined;
  const handler: Handler = Object.assign(
    (request: IncomingMessage, response: ServerResponse) => {
      const finishResponse = (status: number, value?: object) => {
        if (response.destroyed || response.writableEnded) return;
        response.writeHead(status, {
          "Cache-Control": "no-store",
          "Content-Type": "application/json",
          Connection: "close",
        });
        response.end(value ? JSON.stringify(value) : undefined);
      };
      if (request.url !== NATIVE_AUTHORITY_BOOTSTRAP_PATH) {
        finishResponse(404);
        return;
      }
      // A rejected/aborted request may still emit a late stream error.
      request.on("error", () => {});
      const address = request.socket.remoteAddress;
      const authorization = Buffer.from(request.headers.authorization ?? "", "utf8");
      if (
        request.method !== "POST" ||
        Object.hasOwn(request.headers, "origin") ||
        !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address ?? "") ||
        authorization.length !== expected.length ||
        !timingSafeEqual(authorization, expected)
      ) {
        finishResponse(403);
        return;
      }
      if (closed || pending.size >= maximum) {
        finishResponse(503);
        return;
      }
      let settled = false;
      let operationStarted = false;
      let detached = false;
      let bytes = 0;
      let deadline = performance.now() + timeoutMs;
      const chunks: Buffer[] = [];
      const cleanup = () => {
        if (settled) return false;
        settled = true;
        clearTimeout(timer);
        pending.delete(shutdown);
        request.off("data", data);
        request.off("end", end);
        request.off("aborted", aborted);
        response.off("close", aborted);
        return true;
      };
      const detach = (status?: number) => {
        if (settled || detached) return;
        detached = true;
        clearTimeout(timer);
        request.off("data", data);
        request.off("end", end);
        request.off("aborted", aborted);
        response.off("close", aborted);
        if (status) finishResponse(status);
      };
      const reject = (status: number) => {
        if (operationStarted) {
          detach(status);
          return;
        }
        if (cleanup()) finishResponse(status);
      };
      const shutdown = () => reject(503);
      const aborted = () => {
        if (operationStarted) detach();
        else cleanup();
      };
      const data = (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_BODY_BYTES) {
          reject(413);
          return;
        }
        chunks.push(chunk);
      };
      const end = () => {
        if (settled || operationStarted) return;
        request.off("data", data);
        request.off("end", end);
        if (performance.now() >= deadline) {
          reject(408);
          return;
        }
        let body: z.infer<typeof RequestSchema>;
        try {
          const raw = new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(chunks, bytes),
          );
          body = RequestSchema.parse(JSON.parse(raw));
        } catch {
          reject(400);
          return;
        }
        if (body.action !== "describe" && !registry) {
          reject(503);
          return;
        }
        if (body.action === "source-projection-observe") {
          // Bound body admission separately from the accepted Native operation.
          // Detachment keeps the actual registry job and HTTP admission charged.
          deadline = performance.now() + 35_000;
          clearTimeout(timer);
          timer = setTimeout(() => reject(408), 35_000);
          timer.unref();
        }
        operationStarted = true;
        let operation: unknown;
        try {
          switch (body.action) {
            case "describe":
              operation = {
                version: 1,
                environmentId,
                qualified: false,
                ...(registry ? { sourceRegistrationAvailable: true } : {}),
                ...(provisioningLauncher ? { provisioningLauncher } : {}),
              };
              break;
            case "register-source":
              operation = registry!.register({
                deploymentId: body.deploymentId,
                address: body.address,
                registrationNonce: body.registrationNonce,
                expectedHostEnvironmentId: body.expectedHostEnvironmentId,
              });
              break;
            case "lookup-source":
              operation = registry!.lookup({
                deploymentId: body.deploymentId,
                registrationNonce: body.registrationNonce,
                expectedHostEnvironmentId: body.expectedHostEnvironmentId,
              });
              break;
            case "source-status":
              operation = registry!.status({
                associationId: body.associationId,
                sourceEpoch: body.sourceEpoch,
              });
              break;
            case "source-projection-observe":
              operation = registry!.observeProjection(
                {
                  associationId: body.associationId,
                  sourceEpoch: body.sourceEpoch,
                },
                {
                  sessionId: body.sessionId,
                  migrationId: body.migrationId,
                  generation: body.generation,
                },
              );
              break;
            case "unregister-source":
              operation = registry!.unregister({
                associationId: body.associationId,
                sourceEpoch: body.sourceEpoch,
              });
              break;
          }
        } catch (error) {
          operation = Promise.reject(error);
        }
        const done = Promise.resolve(operation)
          .then(
            (value) => {
              if (!detached) {
                if (performance.now() >= deadline) detach(408);
                else finishResponse(200, value as object);
              }
            },
            (error: unknown) => {
              if (detached) return;
              const code =
                error instanceof NativeSourceRegistryError ? error.code : "TRANSPORT_UNKNOWN";
              const status =
                code === "INVALID_REQUEST"
                  ? 400
                  : ["ENVIRONMENT_CHANGED", "REPLAY", "SCOPE_CHANGED"].includes(code)
                    ? 409
                    : code === "SOURCE_CLOSED"
                      ? 404
                      : code === "DEADLINE"
                        ? 504
                        : code === "TRANSPORT_UNKNOWN"
                          ? 502
                          : 503;
              finishResponse(status, { version: 1, error: code, qualified: false });
            },
          )
          .finally(() => {
            cleanup();
            owned.delete(done);
          });
        owned.add(done);
        void done.catch(() => {});
      };
      let timer = setTimeout(() => reject(408), timeoutMs);
      timer.unref();
      pending.add(shutdown);
      request.on("data", data);
      request.once("end", end);
      request.once("aborted", aborted);
      // A later socket abort can emit error after cleanup; keep its inert handler
      // attached to this request until the stream itself is collected.
      request.on("error", aborted);
      response.once("close", aborted);
    },
    {
      close() {
        if (closing) return closing;
        closed = true;
        for (const shutdown of pending) shutdown();
        closing = (async () => {
          try {
            await registry?.close();
          } finally {
            while (owned.size) await Promise.allSettled(owned);
          }
        })();
        return closing;
      },
    },
  );
  return handler;
}
