import { z } from "zod";

const text = (max: number) => z.string().min(1).max(max);

/** Read-only side question about one session; the phone keeps the thread and resends it each call. */
export const SideQuestionParamsSchema = z.strictObject({
  sessionId: text(200),
  question: text(4000),
  /** Earlier turns of the same side thread, oldest first. */
  history: z
    .array(z.strictObject({ role: z.enum(["user", "assistant"]), text: text(16000) }))
    .max(20)
    .optional(),
});
export const SideQuestionResultSchema = z.strictObject({ answer: z.string().max(64000) });

export const SIDE_CHAT_RPC = {
  "sessions.sideQuestion": {
    params: SideQuestionParamsSchema,
    result: SideQuestionResultSchema,
    query: false,
  },
} as const;
