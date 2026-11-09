import type { SocialActionContext } from "../core/social-actions";
import type { SocialAccount, SocialPolicy } from "../../../src/features/social/model/social";
import type { SocialPrincipal } from "../social";
import type { SocialTextGenerator } from "../social-generation";

/**
 * Host calls an AI action needs beyond SocialServiceApi. SocialService already has each member
 * (`call` and `policy` are public methods, `generateText` a public readonly field). They are read
 * once here with a guard, so a missing member fails closed instead of skipping a gate.
 * shortcut: move these into SocialServiceApi (core owner) and drop the cast.
 */
export type AiHostServices = {
  /** The same dispatch the RPC and the UI use: validate, AI stop, gates, audit. */
  call(
    principal: SocialPrincipal,
    method: string,
    input: Record<string, unknown>,
    requestId?: string,
  ): Promise<unknown>;
  policy(account: SocialAccount): Promise<SocialPolicy>;
  generateText?: SocialTextGenerator;
};

export function aiHost(ctx: SocialActionContext): AiHostServices {
  const service = ctx.service as unknown as Partial<AiHostServices>;
  if (typeof service.call !== "function" || typeof service.policy !== "function")
    throw new Error("AI actions are unavailable in this Host build.");
  return service as AiHostServices;
}

/** Runs one registered operation through the same dispatch as every other caller. */
export async function callAction(
  ctx: SocialActionContext,
  principal: SocialPrincipal,
  action: string,
  input: Record<string, unknown>,
  requestId?: string,
): Promise<unknown> {
  return await aiHost(ctx).call(principal, `social.${action}`, input, requestId);
}

export const AI_STOPPED_MESSAGE = "AI actions are stopped by the owner.";

/** Plan runs and planning stop with the global AI stop, for every principal. */
export async function assertAiNotStopped(ctx: SocialActionContext): Promise<void> {
  if ((await ctx.service.setting("ai.stopped")) === "true") throw new Error(AI_STOPPED_MESSAGE);
}
