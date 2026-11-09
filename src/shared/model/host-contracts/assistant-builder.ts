import { z } from "zod";
import { AssistantProfilePatchSchema } from "./assistant-profile";
import { SessionProviderSchema } from "./session-commands";

/**
 * AI profile builder: a text model interviews the owner and proposes assistant profile settings.
 * A proposal is only a draft offer; the owner reviews it and the normal profile Save persists it.
 * Authority-bearing fields (autonomy, execution identities and permissions, setup flags, enable)
 * are never proposed, so the builder cannot grant job, supervision or computer-use authority.
 */
export const AssistantProfileProposalSchema = AssistantProfilePatchSchema.omit({
  avatar: true,
  autonomy: true,
  enabled: true,
  setupComplete: true,
  voiceSetupComplete: true,
  notificationDnd: true,
  execution: true,
  chiefExecution: true,
  replyExecution: true,
  planningExecution: true,
});
export type AssistantProfileProposal = z.infer<typeof AssistantProfileProposalSchema>;

export const AssistantBuilderTurnSchema = z.strictObject({
  role: z.enum(["assistant", "owner"]),
  text: z.string().min(1).max(2000),
});
export type AssistantBuilderTurn = z.infer<typeof AssistantBuilderTurnSchema>;

/** One interview step on a text model chosen in the dialog; the Host runs one isolated prompt. */
export const AssistantProfileInterviewParamsSchema = z.strictObject({
  harness: SessionProviderSchema,
  model: z.string().min(1).max(200),
  modelSettings: z.record(z.string(), z.string()).optional(),
  /** bycoda provider account profile; absent means the provider's own default login. */
  providerAccountId: z.string().min(1).max(80).optional(),
  /** UI locale (BCP 47); questions and the summary are written in it. */
  locale: z.string().min(2).max(20),
  /** The current draft, so questions skip what is already decided and proposals keep the rest. */
  current: AssistantProfileProposalSchema,
  /** Interview so far, oldest first. Empty starts the interview. */
  transcript: z.array(AssistantBuilderTurnSchema).max(30),
  /** The owner asked to stop answering: the reply must be a proposal. */
  finish: z.boolean().optional(),
});

export const AssistantProfileInterviewResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("question"),
    question: z.string().min(1).max(600),
    /** Quick answers the owner can pick; free text is always allowed. */
    options: z.array(z.string().min(1).max(120)).max(6),
  }),
  z.strictObject({
    kind: z.literal("proposal"),
    /** Two or three sentences describing the assistant that was designed. */
    summary: z.string().min(1).max(1200),
    profile: AssistantProfileProposalSchema,
    /** One sentence describing a square avatar portrait that fits the personality. */
    avatarPrompt: z.string().min(1).max(400).optional(),
  }),
]);
export type AssistantProfileInterviewResult = z.infer<typeof AssistantProfileInterviewResultSchema>;

/**
 * Generated avatars are stored by the Host; the profile keeps `image:<id>` (see assistantAvatar).
 * The wire schema bounds the length only; the Host also checks the UUID characters before any
 * file access (wire schemas cannot carry string formats).
 */
export const AssistantAvatarIdSchema = z.string().min(36).max(36);
export const ASSISTANT_AVATAR_ID_PATTERN = /^[0-9a-f-]{36}$/;

/** One square portrait drawn by the provider's native image generation (Codex or Gemini). */
export const AssistantAvatarGenerateParamsSchema = z.strictObject({
  prompt: z.string().min(1).max(600),
  provider: z.enum(["codex", "gemini"]),
});
export const AssistantAvatarGenerateResultSchema = z.strictObject({
  /** The profile avatar value to draft, `image:<id>`. Not saved until the profile is saved. */
  avatar: z.string().min(1).max(200),
});

export const AssistantAvatarReadParamsSchema = z.strictObject({ id: AssistantAvatarIdSchema });
export const AssistantAvatarReadResultSchema = z.strictObject({
  /** `data:image/png;base64,…` or `data:image/jpeg;base64,…`. */
  dataUrl: z.string().min(1).max(12_000_000),
});
