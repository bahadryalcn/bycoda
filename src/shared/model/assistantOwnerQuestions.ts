import { z } from "zod";
import { CUSTOM_OPTION_ID, type UserQuestion } from "./userQuestion";

const id = z.string().min(1).max(200),
  counter = z.number().int().nonnegative();
const boundedText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !!value.trim());
const optionDraft = z.strictObject({
  label: boundedText(120),
  description: boundedText(300).optional(),
});
export const AssistantOwnerQuestionDraftSchema = z.strictObject({
  header: boundedText(80).optional(),
  prompt: boundedText(1000),
  multiSelect: z.boolean(),
  allowCustom: z.boolean(),
  options: z.array(optionDraft).min(1).max(8),
});
const option = z.strictObject({
  id,
  label: boundedText(120),
  description: boundedText(300).optional(),
});
const question = z.strictObject({
  id,
  header: boundedText(80).optional(),
  prompt: boundedText(1000),
  multiSelect: z.boolean(),
  allowCustom: z.boolean(),
  options: z.array(option).min(1).max(8),
});
export const AssistantOwnerAnswerSchema = z.strictObject({
  answers: z.record(id, z.array(id).max(9)).refine((value) => Object.keys(value).length <= 3),
  custom: z
    .record(id, z.string().max(2000))
    .refine((value) => Object.keys(value).length <= 3)
    .optional(),
});
export const AssistantOwnerQuestionAskSchema = z
  .strictObject({
    op: z.literal("questions.ask"),
    jobId: id,
    expectedJobVersion: counter,
    sourceToken: z.string().regex(/^[a-f0-9]{64}$/),
    requestId: id,
    title: boundedText(200).optional(),
    questions: z.array(AssistantOwnerQuestionDraftSchema).min(1).max(3),
    supersedesId: id.optional(),
    expectedSupersededVersion: counter.optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.supersedesId === undefined) !== (value.expectedSupersededVersion === undefined))
      ctx.addIssue({
        code: "custom",
        message: "Superseding a question requires its exact current version.",
      });
  });
export const AssistantOwnerQuestionGetSchema = z.strictObject({
  op: z.literal("questions.get"),
  id,
  requestId: id.optional(),
});
export const AssistantOwnerQuestionPresentSchema = z.strictObject({
  op: z.literal("questions.present"),
  threadId: id,
  ownerMessageId: id,
  requestId: id,
  contextProjectIds: z.array(id).max(1000),
  causalContextId: id.optional(),
  title: boundedText(200).optional(),
  questions: z.array(AssistantOwnerQuestionDraftSchema).min(1).max(3),
});
export const AssistantOwnerQuestionAnswerSchema = z.strictObject({
  op: z.literal("questions.answer"),
  id,
  expectedVersion: counter,
  requestId: id,
  ...AssistantOwnerAnswerSchema.shape,
});
export const AssistantOwnerQuestionSnoozeSchema = z.strictObject({
  op: z.literal("questions.snooze"),
  id,
  expectedVersion: counter,
  requestId: id,
  until: counter,
});
export const AssistantOwnerQuestionCancelSchema = z.strictObject({
  op: z.literal("questions.cancel"),
  id,
  expectedVersion: counter,
  requestId: id,
});
export const AssistantOwnerQuestionMutationSchema = z.union([
  AssistantOwnerQuestionAnswerSchema,
  AssistantOwnerQuestionSnoozeSchema,
  AssistantOwnerQuestionCancelSchema,
]);
export const AssistantOwnerQuestionReceiptSchema = z.strictObject({
  requestId: id,
  kind: z.enum(["answer", "snooze", "cancel"]),
  version: counter,
  at: counter,
  input: AssistantOwnerQuestionMutationSchema,
});
export const AssistantOwnerQuestionSchema = z.strictObject({
  id,
  version: counter,
  jobId: id.nullable(),
  threadId: id.optional(),
  ownerMessageId: id.optional(),
  projectIds: z.array(id).max(1000),
  sourceToken: z.string().regex(/^[a-f0-9]{64}$/),
  sourceCurrent: z.boolean().optional(),
  origin: z.enum(["chief", "voice-proposal", "thread-proposal"]),
  prompt: z.strictObject({
    requestId: counter,
    occurrenceId: id,
    title: boundedText(200).optional(),
    questions: z.array(question).min(1).max(3),
    behavior: z.literal("nonBlocking"),
  }),
  status: z.enum(["open", "snoozed", "answered", "cancelled", "superseded"]),
  createdAt: counter,
  updatedAt: counter,
  snoozedUntil: counter.optional(),
  supersededBy: id.optional(),
  answer: z
    .strictObject({
      requestId: id,
      answers: AssistantOwnerAnswerSchema.shape.answers,
      custom: AssistantOwnerAnswerSchema.shape.custom,
      answeredAt: counter,
      version: counter,
    })
    .optional(),
  lastOwnerAction: AssistantOwnerQuestionReceiptSchema.optional(),
});
export type AssistantOwnerQuestion = z.infer<typeof AssistantOwnerQuestionSchema>;
export type AssistantOwnerQuestionAsk = z.infer<typeof AssistantOwnerQuestionAskSchema>;
export type AssistantOwnerAnswer = z.infer<typeof AssistantOwnerAnswerSchema>;
export type AssistantOwnerQuestionReceipt = z.infer<typeof AssistantOwnerQuestionReceiptSchema>;
export type AssistantOwnerQuestionMutation =
  | z.infer<typeof AssistantOwnerQuestionAnswerSchema>
  | z.infer<typeof AssistantOwnerQuestionSnoozeSchema>
  | z.infer<typeof AssistantOwnerQuestionCancelSchema>;
export type AssistantOwnerQuestionPresent = z.infer<typeof AssistantOwnerQuestionPresentSchema>;

/** Exact canonical IDs only. Free text is data and cannot select another option. */
export function validateAssistantOwnerAnswer(
  questions: readonly UserQuestion[],
  input: AssistantOwnerAnswer,
): AssistantOwnerAnswer {
  const parsed = AssistantOwnerAnswerSchema.parse(input),
    known = new Set(questions.map((item) => item.id));
  if (
    Object.keys(parsed.answers).some((key) => !known.has(key)) ||
    Object.keys(parsed.custom ?? {}).some((key) => !known.has(key))
  )
    throw new Error("The question changed; reload its current choices.");
  const answers: Record<string, string[]> = {},
    custom: Record<string, string> = {};
  for (const question of questions) {
    const selected = parsed.answers[question.id] ?? [],
      text = parsed.custom?.[question.id]?.trim(),
      ids = new Set(question.options.map((option) => option.id));
    if (
      new Set(selected).size !== selected.length ||
      selected.some((id) => !ids.has(id) && !(id === CUSTOM_OPTION_ID && question.allowCustom)) ||
      (!question.multiSelect && selected.length > 1) ||
      (!question.allowCustom && (!!text || selected.includes(CUSTOM_OPTION_ID))) ||
      ((!selected.length || selected.includes(CUSTOM_OPTION_ID)) && !text) ||
      (!selected.length && !question.allowCustom)
    )
      throw new Error(
        "Choose valid current options or an allowed custom answer for every question.",
      );
    if (text && !question.allowCustom)
      throw new Error("This question does not allow a custom answer.");
    answers[question.id] = [...selected];
    if (text) custom[question.id] = text;
  }
  return { answers, ...(Object.keys(custom).length ? { custom } : {}) };
}
