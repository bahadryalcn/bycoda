import {
  SessionsQueueGetParamsSchema,
  SessionsQueueChangeParamsSchema,
  SessionsQueueClaimParamsSchema,
  SessionsQueueFinishParamsSchema,
  SessionsQueueReleaseParamsSchema,
  SessionsQueueLeaseParamsSchema,
} from "../../../src/shared/model/host-contracts/session-queue";
import { assertDomainAuthority, type HostDomainContext } from "../context";

export type SessionQueueAction = "get" | "change" | "claim" | "finish" | "release" | "lease";
export type SessionQueueParams = Record<string, unknown>;
export interface QueueDomainContext extends HostDomainContext {
  /** Authenticated request capability; token/principal credentials remain in composition. */
  exposeAttachments(ids: string[], params: SessionQueueParams): Promise<void>;
}
export interface QueueServiceSnapshot {
  messages: readonly { attachments: readonly { id: string }[] }[];
  claim?: { clientId: string; token?: string };
  settled?: { clientId: string; token?: string; accepted?: boolean; reaped?: boolean };
}
export interface SessionQueueServicePorts<
  Queue extends QueueServiceSnapshot,
  Attachment extends { id: string },
> {
  environmentId: string;
  transaction<T>(work: () => Promise<T>): Promise<T>;
  /** `running` asks for the live status (desktop included); otherwise it is an existence check. */
  sessionStatus(sessionId: string, running?: boolean): Promise<string>;
  desktopWatch(sessionId: string): Promise<{ running?: boolean } | undefined>;
  queues: {
    get(sessionId: string): Promise<Queue>;
    serve(
      action: SessionQueueAction,
      sessionId: string,
      clientId: string,
      params: SessionQueueParams,
      change?: { before: unknown; after: unknown },
    ): Promise<Queue>;
  };
  attachments: {
    validateExposure(params: SessionQueueParams): Promise<void>;
    /** Existing attachment parse/resolution contract; never trust caller paths/ownership. */
    normalize(raw: unknown): Attachment[];
  };
}
const schemas = {
  get: SessionsQueueGetParamsSchema,
  change: SessionsQueueChangeParamsSchema,
  claim: SessionsQueueClaimParamsSchema,
  finish: SessionsQueueFinishParamsSchema,
  release: SessionsQueueReleaseParamsSchema,
  lease: SessionsQueueLeaseParamsSchema,
} as const;

/** SessionQueues remains the sole lease/epoch/CAS/merge owner, including get's side effects. */
export function createSessionQueueService<
  Queue extends QueueServiceSnapshot,
  Attachment extends { id: string },
>(ports: SessionQueueServicePorts<Queue, Attachment>) {
  const normalize = (raw: unknown) => {
    if (!raw || typeof raw !== "object" || !Array.isArray((raw as { messages?: unknown }).messages))
      throw new Error("Invalid queue");
    const value = raw as Record<string, unknown> & { messages: Record<string, unknown>[] };
    return {
      ...value,
      messages: value.messages.map((message) => ({
        ...message,
        attachments: ports.attachments
          .normalize(message.attachments)
          .map((file) => ({ ...file, hostEnvironmentId: ports.environmentId })),
      })),
    };
  };
  const execute = async (
    action: SessionQueueAction,
    raw: SessionQueueParams,
    context: QueueDomainContext,
    options: { legacy?: boolean } = {},
  ): Promise<Queue> => {
    await assertDomainAuthority(context);
    // Only HTTP opts into historic coercions and unrelated extension fields.
    const params: SessionQueueParams = options.legacy ? raw : schemas[action].parse(raw);
    const id = String(params.sessionId ?? "");
    await ports.attachments.validateExposure(params);
    await assertDomainAuthority(context);
    // Only recovering an unaccepted claim looks at whether a turn runs; every other
    // action just needs the conversation to exist, which the host store answers directly.
    await ports.sessionStatus(id, false);
    await assertDomainAuthority(context);
    const clientId = params.clientId;
    if (typeof clientId !== "string" || !clientId || clientId.length > 200)
      throw new Error("Invalid queue client");
    const validateFinish = async () => {
      const current = await ports.queues.get(id);
      await assertDomainAuthority(context);
      if (current.claim?.clientId !== clientId && current.settled?.clientId !== clientId)
        throw new Error("Queued send belongs to another client.");
      if (typeof params.accepted !== "boolean") throw new Error("Invalid queue acknowledgement");
      const settled = current.settled;
      const replay =
        !settled?.reaped &&
        settled?.token === params.token &&
        settled?.clientId === clientId &&
        settled?.accepted === params.accepted;
      const deferred =
        params.deferred === true &&
        current.claim?.token === params.token &&
        current.claim?.clientId === clientId;
      if (params.accepted === false && !replay && !deferred) {
        const status = await ports.sessionStatus(id, true);
        const desktop = await ports.desktopWatch(id);
        await assertDomainAuthority(context);
        if (desktop?.running || status === "running")
          throw new Error("Wait for the running turn before recovering its queued message.");
      }
    };
    const change =
      action === "change"
        ? { before: normalize(params.before), after: normalize(params.after) }
        : undefined;
    const result = await ports.transaction(async () => {
      // Admission may have waited behind another writer. Recheck at the actual owner.
      await assertDomainAuthority(context);
      if (action === "finish") await validateFinish();
      return ports.queues.serve(action, id, clientId, params, change);
    });
    // Even get can renew a legacy drain lease and grant attachment claims. No read cache/retry shim.
    await assertDomainAuthority(context);
    await context.exposeAttachments(
      result.messages.flatMap((message) => message.attachments.map((file) => file.id)),
      params,
    );
    await assertDomainAuthority(context);
    return result;
  };
  return {
    get: (
      params: SessionQueueParams,
      context: QueueDomainContext,
      options?: { legacy?: boolean },
    ) => execute("get", params, context, options),
    change: (
      params: SessionQueueParams,
      context: QueueDomainContext,
      options?: { legacy?: boolean },
    ) => execute("change", params, context, options),
    claim: (
      params: SessionQueueParams,
      context: QueueDomainContext,
      options?: { legacy?: boolean },
    ) => execute("claim", params, context, options),
    finish: (
      params: SessionQueueParams,
      context: QueueDomainContext,
      options?: { legacy?: boolean },
    ) => execute("finish", params, context, options),
    release: (
      params: SessionQueueParams,
      context: QueueDomainContext,
      options?: { legacy?: boolean },
    ) => execute("release", params, context, options),
    lease: (
      params: SessionQueueParams,
      context: QueueDomainContext,
      options?: { legacy?: boolean },
    ) => execute("lease", params, context, options),
  };
}
