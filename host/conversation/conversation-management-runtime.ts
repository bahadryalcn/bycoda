import { createHash } from "node:crypto";
import type { RuntimeLogSubjectPrincipal } from "../execution/runtime-log-tools";
import type { GlobalManagementPrincipal } from "./conversation-management-tools";
import { withTimeout } from "../../src/shared/lib/withTimeout";
const integer = { type: "integer", minimum: 0 };
const text = { type: "string", minLength: 1, maxLength: 300 };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export const RUNTIME_MANAGEMENT_TOOLS = {
  "environment.describe": object({}),
  "environment.persistence.status": object({}),
  "history.import.status": object({ operationId: text }, ["operationId"]),
  "sync.status": object({}),
  "tunnels.status": object({
    offset: integer,
    limit: { type: "integer", minimum: 1, maximum: 100 },
  }),
  "mobile.access.status": object({ mode: { enum: ["lan", "tailscale"] } }),
  "events.subscribe": object({
    cursor: { type: "string", pattern: "^[a-f0-9]{64}$" },
    waitMs: { type: "integer", minimum: 0, maximum: 20000 },
  }),
} as const;
export type RuntimeManagementAction = keyof typeof RUNTIME_MANAGEMENT_TOOLS;
export const isGlobalRuntimeRead = (action: string) =>
  ["environment.describe", "environment.persistence.status", "sync.status"].includes(action);
type RuntimeReadPrincipal = RuntimeLogSubjectPrincipal | GlobalManagementPrincipal;
export const isRuntimeManagementAction = (action: string): action is RuntimeManagementAction =>
  Object.hasOwn(RUNTIME_MANAGEMENT_TOOLS, action);
export const describeRuntimeManagementTool = (action: string) =>
  isRuntimeManagementAction(action)
    ? action === "events.subscribe"
      ? "Subscribe to committed project work changes using bounded long polling. Reuse the returned cursor; response is a current bounded metadata snapshot, not durable event replay. Timeout is a heartbeat. No operation or microphone starts."
      : "Read bounded application runtime status. Credentials, pairing secrets and private content are excluded; unknown state is not readiness."
    : undefined;
type Input = Record<string, unknown>;
export type RuntimeManagementPorts = {
  read(
    action: Exclude<RuntimeManagementAction, "events.subscribe">,
    input: Input,
    principal: RuntimeReadPrincipal,
    authorized: () => Promise<boolean>,
  ): Promise<unknown>;
  snapshot(projectId: string): Promise<unknown[]>;
  subscribe(listener: () => void): () => void;
};
const pick = (value: unknown, keys: string[]) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { state: "unknown" };
  return Object.fromEntries(
    keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, (value as Input)[key]]),
  );
};
export function runtimeStatusProjection(action: string, value: unknown, input: Input = {}) {
  if (action === "environment.describe")
    return pick(value, [
      "protocolVersion",
      "environmentId",
      "name",
      "platform",
      "providers",
      "capabilities",
    ]);
  if (action === "mobile.access.status") return pick(value, ["state", "mode", "machineName"]);
  if (action === "environment.persistence.status")
    return pick(value, [
      "status",
      "state",
      "mode",
      "durable",
      "healthy",
      "recoveryRequired",
      "reason",
      "backend",
    ]);
  if (action === "sync.status") return pick(value, ["revision", "available", "state"]);
  if (action === "history.import.status") {
    const raw = value as { progress?: unknown; result?: unknown } | undefined;
    return {
      ...pick(value, ["state"]),
      ...(raw?.progress
        ? { progress: pick(raw.progress, ["total", "done", "imported", "skipped", "failed"]) }
        : {}),
      ...(raw?.result
        ? {
            result: pick(raw.result, [
              "imported",
              "skipped",
              "failed",
              "readOnly",
              "truncated",
              "cancelled",
            ]),
          }
        : {}),
    };
  }
  if (action === "tunnels.status") {
    const raw = value as { environmentId?: string; tunnels?: unknown[]; providers?: unknown[] };
    const rows = Array.isArray(raw?.tunnels) ? raw.tunnels : [];
    const offset = Number(input.offset ?? 0),
      limit = Number(input.limit ?? 30);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error("Invalid tunnel pagination.");
    return {
      environmentId: raw?.environmentId,
      providers: (raw?.providers ?? [])
        .slice(0, 20)
        .map((row) => pick(row, ["provider", "installed", "credential"])),
      items: rows
        .slice(offset, offset + limit)
        .map((row) =>
          pick(row, ["id", "provider", "target", "state", "issue", "startedAt", "canStop"]),
        ),
      total: rows.length,
      nextOffset: offset + limit < rows.length ? offset + limit : null,
    };
  }
  throw new Error("Unsupported runtime status.");
}
export class ConversationManagementRuntime {
  constructor(private readonly ports: RuntimeManagementPorts) {}
  async call(
    action: RuntimeManagementAction,
    input: Input,
    principal: RuntimeReadPrincipal,
    authorized: () => Promise<boolean>,
  ) {
    const check = async () => {
      if (!(await withTimeout(authorized(), 5000, "Conversation authority")))
        throw new Error("Conversation authority revoked.");
    };
    await check();
    if (!principal.projectId && !isGlobalRuntimeRead(action))
      throw new Error("Choose an explicit project for this runtime operation.");
    if (action !== "events.subscribe") {
      const raw = await withTimeout(
        this.ports.read(action, input, principal, authorized),
        15_000,
        "Runtime status",
      );
      await check();
      return runtimeStatusProjection(action, raw, input);
    }
    const wait = input.waitMs ?? 20_000;
    const projectId = principal.projectId;
    if (!projectId) throw new Error("Choose an explicit project for event subscription.");
    if (
      !Number.isSafeInteger(wait) ||
      Number(wait) < 0 ||
      Number(wait) > 20_000 ||
      (input.cursor !== undefined &&
        (typeof input.cursor !== "string" || !/^[a-f0-9]{64}$/.test(input.cursor)))
    )
      throw new Error("Invalid event subscription.");
    return new Promise<unknown>((resolve, reject) => {
      let stopped = false,
        reading = false,
        dirty = false,
        heartbeatPending = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let unlisten = () => {};
      const finish = (error?: unknown, value?: unknown) => {
        if (stopped) return;
        stopped = true;
        clearTimeout(timer);
        unlisten();
        if (error) reject(error);
        else resolve(value);
      };
      const read = async (heartbeat = false) => {
        if (stopped) return;
        if (reading) {
          dirty = true;
          heartbeatPending ||= heartbeat;
          return;
        }
        reading = true;
        try {
          await check();
          const all = await withTimeout(this.ports.snapshot(projectId), 5000, "Project events");
          await check();
          const items = all.slice(0, 100);
          const cursor = createHash("sha256")
            .update(JSON.stringify([projectId, all]))
            .digest("hex");
          if (heartbeat || heartbeatPending || cursor !== input.cursor)
            finish(undefined, {
              cursor,
              items,
              total: all.length,
              truncated: all.length > items.length,
              heartbeat: cursor === input.cursor,
              transport: "long-poll",
              durableReplay: false,
              coverage: "bounded-project-snapshot",
            });
        } catch (error) {
          finish(error);
        } finally {
          reading = false;
          if (dirty && !stopped) {
            dirty = false;
            void read().catch(finish);
          }
        }
      };
      unlisten = this.ports.subscribe(() => {
        void read().catch(finish);
      });
      timer = setTimeout(() => {
        void read(true).catch(finish);
      }, Number(wait));
      void read(input.cursor === undefined || wait === 0).catch(finish);
    });
  }
}
