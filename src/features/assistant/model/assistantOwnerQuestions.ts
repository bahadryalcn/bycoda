import { z } from "zod";
import {
  AssistantOwnerQuestionSchema,
  AssistantOwnerQuestionAnswerSchema,
  AssistantOwnerQuestionSnoozeSchema,
  AssistantOwnerQuestionGetSchema,
  validateAssistantOwnerAnswer,
  type AssistantOwnerQuestion,
  type AssistantOwnerQuestionReceipt,
} from "../../../shared/model/assistantOwnerQuestions";
import {
  CUSTOM_OPTION_ID,
  type UserQuestionPrompt,
  type UserQuestionReply,
} from "../../sessions/model/userQuestion";
import type { QuestionDraft } from "../../sessions/model/questionDrafts";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
export type OwnerQuestionRequest =
  | z.infer<typeof AssistantOwnerQuestionGetSchema>
  | z.infer<typeof AssistantOwnerQuestionAnswerSchema>
  | z.infer<typeof AssistantOwnerQuestionSnoozeSchema>;
export type OwnerQuestionResponse = {
  ownerQuestion?: AssistantOwnerQuestion | null;
  ownerQuestionReceipt?: AssistantOwnerQuestionReceipt;
};
export type OwnerQuestionPort = (
  input: OwnerQuestionRequest,
  expectedEnvironmentId: string,
) => Promise<OwnerQuestionResponse>;
const text = z.string().max(2000),
  answers = z.record(z.string(), z.array(z.string()).max(9));
const draftSchema = z.strictObject({
  step: z.number().int().min(0).max(3),
  answers,
  custom: z.record(z.string(), text),
  delivery: z.enum(["sending", "unknown"]).optional(),
  pendingAction: z.enum(["answer", "dismiss"]).optional(),
});
const recordSchema = z.strictObject({
  format: z.literal(1),
  environmentId: z.string().min(1).max(200),
  question: AssistantOwnerQuestionSchema,
  draft: draftSchema,
  intent: z
    .union([AssistantOwnerQuestionAnswerSchema, AssistantOwnerQuestionSnoozeSchema])
    .optional(),
});
type RecordValue = z.infer<typeof recordSchema>;
const prefix = "bycoda.assistant.owner-question:";
const indexKey = (environmentId: string) => `${prefix}pending:${encodeURIComponent(environmentId)}`;
export const ownerQuestionDraftScope = (
  environmentId: string,
  question: Pick<AssistantOwnerQuestion, "id" | "version">,
) =>
  `${prefix}${encodeURIComponent(JSON.stringify([environmentId, question.id, question.version]))}`;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
export function ownerQuestionError(error: unknown): string {
  if (error instanceof z.ZodError)
    return error.issues.some((issue) => issue.code === "too_big" && issue.path.includes("custom"))
      ? "Keep custom answers within 2,000 characters."
      : "The question data could not be verified. Refresh its original Host.";
  return error instanceof Error ? error.message : String(error);
}
const semantic = (question: AssistantOwnerQuestion) => ({
  id: question.id,
  jobId: question.jobId,
  projectIds: question.projectIds,
  sourceToken: question.sourceToken,
  origin: question.origin,
  threadId: question.threadId,
  ownerMessageId: question.ownerMessageId,
  prompt: question.prompt,
});
export function ownerQuestionVisible(
  question: AssistantOwnerQuestion,
  visibleProjectIds: readonly string[],
): boolean {
  return (
    Array.isArray(question.projectIds) &&
    (question.projectIds.length > 0 ||
      (question.origin !== "chief" && !!question.threadId && !!question.ownerMessageId)) &&
    question.projectIds.every((id) => visibleProjectIds.includes(id))
  );
}
/** Canonical labels, including "Other", remain literal options with their Host IDs. */
export function ownerQuestionPrompt(
  question: AssistantOwnerQuestion,
  customLabel = "Other",
): UserQuestionPrompt {
  return {
    ...structuredClone(question.prompt),
    questions: question.prompt.questions.map((item) => ({
      ...item,
      options: [
        ...item.options.map((option) => ({ ...option, literal: true })),
        ...(item.allowCustom ? [{ id: CUSTOM_OPTION_ID, label: customLabel }] : []),
      ],
    })),
  };
}
function readIndex(storage: Storage, environmentId: string, strict = false): string[] {
  try {
    return z
      .array(z.string().max(2000))
      .max(20)
      .parse(JSON.parse(storage.getItem(indexKey(environmentId)) ?? "[]"));
  } catch {
    if (strict) throw new Error("Invalid pending question index");
    return [];
  }
}
function readRecord(storage: Storage, key: string): RecordValue | undefined {
  try {
    const raw = storage.getItem(key);
    if (!raw || raw.length > 128000) return;
    return recordSchema.parse(JSON.parse(raw));
  } catch {
    return;
  }
}
/** Pending cards survive a lost acknowledgement even if the question leaves the Host's recent page. */
export function pendingOwnerQuestions(
  storage: Storage,
  environmentId: string,
): AssistantOwnerQuestion[] {
  return readIndex(storage, environmentId).flatMap((key) => {
    const value = readRecord(storage, key);
    return value?.intent && value.environmentId === environmentId ? [value.question] : [];
  });
}
export class AssistantOwnerQuestionDraft {
  readonly scope: string;
  private record: RecordValue;
  private sending?: Promise<AssistantOwnerQuestion>;
  constructor(
    question: AssistantOwnerQuestion,
    readonly environmentId: string,
    private readonly storage: Storage,
    private readonly createId: () => string,
    private readonly authorized: () => boolean,
    private readonly changed?: () => void,
  ) {
    const captured = AssistantOwnerQuestionSchema.parse(structuredClone(question));
    if (!environmentId || environmentId.length > 200)
      throw new Error(
        "The original Host could not be verified. Keep this draft and reconnect its original computer.",
      );
    this.scope = ownerQuestionDraftScope(environmentId, captured);
    const saved = readRecord(storage, this.scope);
    if (
      saved &&
      saved.environmentId === environmentId &&
      same(semantic(saved.question), semantic(captured))
    )
      this.record = saved;
    else if (storage.getItem(this.scope))
      throw new Error(
        "The saved question draft does not match its original question. Keep it and refresh the question.",
      );
    else
      this.record = {
        format: 1,
        environmentId,
        question: captured,
        draft: { step: 0, answers: {}, custom: {} },
      };
  }
  get question(): AssistantOwnerQuestion {
    return structuredClone(this.record.question);
  }
  get formDraft(): QuestionDraft {
    const value = structuredClone(this.record.draft);
    if (!this.record.intent) {
      delete value.delivery;
      delete value.pendingAction;
    }
    return value;
  }
  get intentPending(): boolean {
    return !!this.record.intent;
  }
  private notify() {
    try {
      this.changed?.();
    } catch {
      /* Observers cannot undo a durable intent or acknowledged answer. */
    }
  }
  private assert() {
    if (!this.authorized())
      throw new Error(
        "The question's Host or project visibility changed. Keep the original draft.",
      );
  }
  private persist() {
    try {
      const encoded = JSON.stringify(this.record);
      if (encoded.length > 128000) throw new Error("size");
      this.storage.setItem(this.scope, encoded);
      if (this.record.intent) {
        const keys = readIndex(this.storage, this.environmentId, true);
        if (!keys.includes(this.scope)) keys.push(this.scope);
        if (keys.length > 20) throw new Error("capacity");
        this.storage.setItem(indexKey(this.environmentId), JSON.stringify(keys));
      }
    } catch {
      throw new Error(
        "The question draft could not be saved on this device. Keep this card open and retry.",
      );
    }
  }
  private adoptPending() {
    const stored = readRecord(this.storage, this.scope);
    if (stored?.intent && (!this.record.intent || !same(stored.intent, this.record.intent))) {
      this.record = stored;
      throw new Error(
        "The previous answer is unconfirmed. Check the original question before retrying.",
      );
    }
  }
  saveDraft(draft: QuestionDraft) {
    this.assert();
    this.adoptPending();
    try {
      this.record = { ...this.record, draft: draftSchema.parse(draft) };
    } catch (error) {
      throw new Error(ownerQuestionError(error));
    }
    this.persist();
  }
  private clear() {
    this.record = {
      ...this.record,
      intent: undefined,
      draft: { step: 0, answers: {}, custom: {} },
    };
    try {
      const keys = readIndex(this.storage, this.environmentId, true);
      this.storage.removeItem(this.scope);
      this.storage.setItem(
        indexKey(this.environmentId),
        JSON.stringify(keys.filter((key) => key !== this.scope)),
      );
    } catch {
      /* A retained exact intent can only reconcile its same Host receipt, never replay blindly. */
    }
    this.notify();
  }
  private accepted(
    response: OwnerQuestionResponse,
    intent = this.record.intent,
  ): AssistantOwnerQuestion | undefined {
    const current = response.ownerQuestion;
    if (!intent || !current || !same(semantic(current), semantic(this.record.question))) return;
    const receipt = response.ownerQuestionReceipt ?? current.lastOwnerAction;
    const kind = intent.op === "questions.answer" ? "answer" : "snooze";
    if (
      !receipt ||
      receipt.requestId !== intent.requestId ||
      receipt.kind !== kind ||
      receipt.version !== intent.expectedVersion + 1 ||
      !same(receipt.input, intent)
    )
      return;
    return current;
  }
  /** A fresh Host snapshot may resolve an acknowledgement; it can never dispatch an answer. */
  observe(question: AssistantOwnerQuestion): boolean {
    this.assert();
    this.adoptPending();
    if (!this.accepted({ ownerQuestion: question })) return false;
    this.clear();
    return true;
  }
  submit(
    reply: UserQuestionReply,
    request: OwnerQuestionPort,
    until: number,
  ): Promise<AssistantOwnerQuestion> {
    if (this.sending) return this.sending;
    this.assert();
    this.adoptPending();
    if (this.record.intent)
      throw new Error(
        "The previous answer is unconfirmed. Check the original question before retrying.",
      );
    const question = this.record.question;
    if (question.sourceCurrent === false || !["open", "snoozed"].includes(question.status))
      throw new Error("This question changed with its work. Refresh it before answering.");
    const base = { id: question.id, expectedVersion: question.version, requestId: this.createId() };
    let intent: NonNullable<RecordValue["intent"]>;
    try {
      intent =
        reply.kind === "skipped"
          ? AssistantOwnerQuestionSnoozeSchema.parse({ op: "questions.snooze", ...base, until })
          : AssistantOwnerQuestionAnswerSchema.parse({
              op: "questions.answer",
              ...base,
              ...validateAssistantOwnerAnswer(question.prompt.questions, {
                answers: reply.answers,
                ...(reply.custom ? { custom: reply.custom } : {}),
              }),
            });
    } catch (error) {
      throw new Error(ownerQuestionError(error));
    }
    this.record = { ...this.record, intent };
    this.persist();
    this.notify();
    return this.deliver(request);
  }
  retry(request: OwnerQuestionPort): Promise<AssistantOwnerQuestion> {
    if (this.sending) return this.sending;
    if (!this.record.intent)
      return Promise.reject(new Error("There is no pending answer to verify."));
    this.assert();
    this.persist();
    return this.deliver(request);
  }
  private deliver(request: OwnerQuestionPort): Promise<AssistantOwnerQuestion> {
    const intent = structuredClone(this.record.intent!);
    this.sending = (async () => {
      this.assert();
      const inspected = await request(
        { op: "questions.get", id: intent.id, requestId: intent.requestId },
        this.environmentId,
      );
      this.assert();
      const acknowledged = this.accepted(inspected, intent);
      if (acknowledged) {
        this.clear();
        return acknowledged;
      }
      const current = inspected.ownerQuestion;
      if (!current)
        throw new Error(
          "The question is no longer available. Keep this draft and review its original work.",
        );
      if (
        current.version !== intent.expectedVersion ||
        !same(semantic(current), semantic(this.record.question)) ||
        current.sourceCurrent === false ||
        !["open", "snoozed"].includes(current.status)
      )
        throw new Error("This question changed with its work. Refresh it before answering.");
      const result = await request(structuredClone(intent), this.environmentId);
      this.assert();
      const complete = this.accepted(result, intent);
      if (!complete)
        throw new Error(
          "The answer could not be verified. Keep this draft and check the original question.",
        );
      this.clear();
      return complete;
    })().finally(() => {
      this.sending = undefined;
    });
    return this.sending;
  }
}
