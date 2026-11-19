import { z } from "zod";
import type { HostRpcMethodDefinition } from "./methods";

const text = (limit: number) => z.string().min(1).max(limit);
const count = z.number().int().nonnegative();
const empty = z.strictObject({});
export const LiveStreamStartParamsSchema = z.strictObject({ channel: text(2048) });
export const LiveStreamObsStreamParamsSchema = z.strictObject({
  action: z.enum(["start", "stop"]),
});
export const LiveStreamObsCredentialsParamsSchema = z.strictObject({
  server: text(2048),
  key: text(2048),
});
export const LiveStreamEulerKeyParamsSchema = z.strictObject({ key: z.string().max(512) });
const platform = z.enum(["tiktok", "demo"]);
const totals = z.strictObject({
  diamonds: count,
  gifts: count,
  comments: count,
  likes: count,
  follows: count,
  peakViewers: count,
});
const gifter = z.strictObject({
  id: z.string(),
  name: z.string(),
  diamonds: count,
  avatarUrl: z.string().optional(),
});
export const LiveStreamReportSchema = z.strictObject({
  channel: z.string(),
  platform,
  startedAt: count,
  endedAt: count.optional(),
  totals,
  topGifters: z.array(gifter),
});
export const LiveStreamStatusSchema = z.strictObject({
  connection: z.strictObject({
    platform,
    channel: z.string(),
    attempts: count,
    status: z.enum(["idle", "connecting", "connected", "reconnecting", "offline", "error"]),
    detail: z.string().optional(),
    roomId: z.string().optional(),
    connectedAt: count.optional(),
  }),
  snapshot: z.strictObject({
    viewers: count,
    totals,
    topGifters: z.array(gifter),
  }),
  obs: z.strictObject({
    configured: z.boolean(),
    streaming: z.boolean().optional(),
    scene: z.string().optional(),
  }),
  eulerKeyConfigured: z.boolean(),
  events: z.array(
    z.strictObject({
      id: z.string(),
      at: count,
      kind: z.enum(["comment", "gift", "like", "join", "follow", "share", "viewers", "stream-end"]),
      name: z.string().optional(),
      text: z.string().optional(),
      count: count.optional(),
    }),
  ),
});
export type LiveStreamStatus = z.infer<typeof LiveStreamStatusSchema>;
export type LiveStreamReport = z.infer<typeof LiveStreamReportSchema>;

const liveTargetText = z.string().min(1).max(256);
/** `scene` names an existing OBS scene; without it the scene OBS currently shows is used. */
export const LiveStreamLiveStartParamsSchema = z.strictObject({
  accountId: liveTargetText,
  scene: liveTargetText.optional(),
});
const livePlatform = z.enum(["youtube", "tiktok", "instagram", "facebook", "linkedin", "x"]);
const liveAccount = z.strictObject({
  accountId: z.string(),
  platform: livePlatform,
  label: z.string(),
});
const liveAccounts = z.strictObject({ accounts: z.array(liveAccount) });
export const LiveStreamLiveStatusSchema = z.strictObject({
  state: z.enum(["idle", "starting", "streaming", "stopping", "uncertain", "owner_step", "failed"]),
  canStop: z.boolean(),
  accountId: z.string().optional(),
  platform: livePlatform.optional(),
  scene: z.string().optional(),
  obsStreaming: z.boolean().optional(),
  managedDestination: z.boolean().optional(),
  needsPlatformConfirmation: z.boolean().optional(),
  reason: z
    .enum([
      "OBS_NOT_CONFIGURED",
      "OBS_UNAVAILABLE",
      "OBS_ALREADY_STREAMING",
      "SCENE_NOT_FOUND",
      "ACCOUNT_UNAVAILABLE",
      "AUTHORITY_DENIED",
      "LIVE_CREDENTIALS_MISSING",
      "OWNER_STEP_REQUIRED",
      "PLATFORM_FAILED",
      "START_UNCERTAIN",
      "STOP_UNCERTAIN",
      "CANCELED",
    ])
    .optional(),
});
export type LiveStreamLiveAccount = z.infer<typeof liveAccount>;
export type LiveStreamLiveStatus = z.infer<typeof LiveStreamLiveStatusSchema>;
export type LiveStreamLiveStartParams = z.infer<typeof LiveStreamLiveStartParamsSchema>;

export function parseLiveStreamLiveStart(input: unknown): LiveStreamLiveStartParams {
  const params = LiveStreamLiveStartParamsSchema.parse(input);
  return LiveStreamLiveStartParamsSchema.parse({
    accountId: params.accountId.trim(),
    scene: params.scene?.trim(),
  });
}

export const LIVE_STREAM_RPC = {
  "liveStream.status": { params: empty, result: LiveStreamStatusSchema, query: true },
  "liveStream.start": { params: LiveStreamStartParamsSchema, result: LiveStreamStatusSchema },
  "liveStream.stop": { params: empty, result: LiveStreamStatusSchema },
  "liveStream.demo": { params: empty, result: LiveStreamStatusSchema },
  "liveStream.report": { params: empty, result: LiveStreamReportSchema.nullable(), query: true },
  "liveStream.obsSetup": { params: empty, result: LiveStreamStatusSchema },
  "liveStream.obsStream": {
    params: LiveStreamObsStreamParamsSchema,
    result: LiveStreamStatusSchema,
  },
  "liveStream.obsCredentials": {
    params: LiveStreamObsCredentialsParamsSchema,
    result: LiveStreamStatusSchema,
  },
  "liveStream.eulerKey": { params: LiveStreamEulerKeyParamsSchema, result: LiveStreamStatusSchema },
  "liveStream.live.accounts": { params: empty, result: liveAccounts, query: true },
  "liveStream.live.status": { params: empty, result: LiveStreamLiveStatusSchema, query: true },
  "liveStream.live.start": {
    params: LiveStreamLiveStartParamsSchema,
    result: LiveStreamLiveStatusSchema,
  },
  "liveStream.live.stop": {
    params: z.strictObject({ platformEnded: z.literal(true).optional() }),
    result: LiveStreamLiveStatusSchema,
  },
} as const;

export function liveStreamMethods(
  workflow: (
    capability: string,
    params: z.ZodType,
    result: z.ZodType,
    query?: boolean,
  ) => HostRpcMethodDefinition,
) {
  return Object.fromEntries(
    Object.entries(LIVE_STREAM_RPC).map(([name, definition]) => [
      name,
      {
        ...workflow("liveStream.v1", definition.params, definition.result, "query" in definition),
        ...(name === "liveStream.live.start" || name === "liveStream.live.stop"
          ? { responseTimeoutMs: 120_000 }
          : name === "liveStream.obsSetup"
            ? { responseTimeoutMs: 60_000 }
            : {}),
      },
    ]),
  ) as Record<keyof typeof LIVE_STREAM_RPC, HostRpcMethodDefinition>;
}
