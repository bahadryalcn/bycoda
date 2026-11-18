import { z } from "zod";
import type { HostRpcMethodDefinition } from "./methods";

const text = (limit: number) => z.string().min(1).max(limit);
const count = z.number().int().nonnegative();
const empty = z.strictObject({});
const actions = z.enum([
  "join",
  "front",
  "leader",
  "tempo",
  "confetti",
  "drum",
  "fireworks",
  "money-rain",
  "handkerchief",
]);
export const LiveGamesRuleSchema = z.strictObject({
  minDiamonds: count.max(100_000_000),
  giftName: text(60).optional(),
  actions: z.array(actions).min(1).max(actions.options.length),
});
export const LiveGamesRulesSchema = z.array(LiveGamesRuleSchema).max(100);
const config = z.strictObject({
  joinKeywords: z.array(text(40)).max(32),
  joinOnAnyComment: z.boolean(),
  joinOnLike: z.boolean(),
  joinOnFollow: z.boolean(),
  capacity: z.number().int().min(1).max(120),
  leaderHoldSeconds: count.max(3600),
  frontHoldSeconds: count.max(3600),
  giftRules: LiveGamesRulesSchema,
  blocked: z.array(text(64)).max(500),
  shortNames: z.boolean(),
});
export const LiveGamesConfigPatchSchema = config.omit({ giftRules: true }).partial();
export const LiveGamesStartParamsSchema = z.strictObject({ channel: text(2048) });
export const LiveGamesRulesParamsSchema = z.strictObject({ rules: LiveGamesRulesSchema });
export const LiveGamesConfigParamsSchema = z.strictObject({ patch: LiveGamesConfigPatchSchema });
const aspect = z.enum(["9:16", "16:9"]);
export const LiveGamesObsSetupParamsSchema = z.strictObject({
  aspect: aspect.optional(),
  clean: z.boolean().optional(),
  mute: z.boolean().optional(),
});
export type LiveGamesObsSetupOptions = z.infer<typeof LiveGamesObsSetupParamsSchema>;
export const LiveGamesObsStreamParamsSchema = z.strictObject({ action: z.enum(["start", "stop"]) });
export const LiveGamesObsCredentialsParamsSchema = z.strictObject({
  server: text(2048),
  key: text(2048),
});
export const LiveGamesEulerKeyParamsSchema = z.strictObject({ key: z.string().max(512) });
const platform = z.enum(["tiktok", "demo"]);
const totals = z.strictObject({
  diamonds: count,
  gifts: count,
  comments: count,
  likes: count,
  joins: count,
  follows: count,
  peakViewers: count,
});
const gifter = z.strictObject({
  id: z.string(),
  name: z.string(),
  diamonds: count,
  avatarUrl: z.string().optional(),
});
const feedItem = z.strictObject({ id: z.string(), at: count, text: z.string() });
export const LiveGamesReportSchema = z.strictObject({
  channel: z.string(),
  platform,
  startedAt: count,
  endedAt: count.optional(),
  totals,
  topGifters: z.array(gifter),
});
export const LiveGamesStatusSchema = z.strictObject({
  connection: z.strictObject({
    platform,
    channel: z.string(),
    attempts: count,
    status: z.enum(["idle", "connecting", "connected", "reconnecting", "offline", "error"]),
    detail: z.string().optional(),
    roomId: z.string().optional(),
    connectedAt: count.optional(),
  }),
  config,
  snapshot: z.strictObject({
    dancers: z.array(
      gifter.extend({ handle: z.string(), role: z.enum(["leader", "front", "dancer"]) }),
    ),
    tempo: z.number(),
    viewers: count,
    totals,
    topGifters: z.array(gifter),
    feed: z.array(feedItem),
  }),
  overlayUrl: z.string(),
  obs: z.strictObject({
    configured: z.boolean(),
    streaming: z.boolean().optional(),
    scene: z.string().optional(),
    aspect: aspect.optional(),
    clean: z.boolean().optional(),
    mute: z.boolean().optional(),
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
export type LiveGamesStatus = z.infer<typeof LiveGamesStatusSchema>;
export type LiveGamesReport = z.infer<typeof LiveGamesReportSchema>;

export const LIVE_GAMES_RPC = {
  "liveGames.status": { params: empty, result: LiveGamesStatusSchema, query: true },
  "liveGames.start": { params: LiveGamesStartParamsSchema, result: LiveGamesStatusSchema },
  "liveGames.stop": { params: empty, result: LiveGamesStatusSchema },
  "liveGames.demo": { params: empty, result: LiveGamesStatusSchema },
  "liveGames.setRules": { params: LiveGamesRulesParamsSchema, result: LiveGamesStatusSchema },
  "liveGames.setConfig": { params: LiveGamesConfigParamsSchema, result: LiveGamesStatusSchema },
  "liveGames.report": { params: empty, result: LiveGamesReportSchema.nullable(), query: true },
  "liveGames.obsSetup": { params: LiveGamesObsSetupParamsSchema, result: LiveGamesStatusSchema },
  "liveGames.obsStream": { params: LiveGamesObsStreamParamsSchema, result: LiveGamesStatusSchema },
  "liveGames.obsScene": { params: empty, result: LiveGamesStatusSchema },
  "liveGames.obsCredentials": {
    params: LiveGamesObsCredentialsParamsSchema,
    result: LiveGamesStatusSchema,
  },
  "liveGames.eulerKey": { params: LiveGamesEulerKeyParamsSchema, result: LiveGamesStatusSchema },
} as const;

export function liveGamesMethods(
  workflow: (
    capability: string,
    params: z.ZodType,
    result: z.ZodType,
    query?: boolean,
  ) => HostRpcMethodDefinition,
) {
  return Object.fromEntries(
    Object.entries(LIVE_GAMES_RPC).map(([name, definition]) => [
      name,
      {
        ...workflow("liveGames.v1", definition.params, definition.result, "query" in definition),
        ...(name === "liveGames.obsSetup" ? { responseTimeoutMs: 60_000 } : {}),
      },
    ]),
  ) as Record<keyof typeof LIVE_GAMES_RPC, HostRpcMethodDefinition>;
}
