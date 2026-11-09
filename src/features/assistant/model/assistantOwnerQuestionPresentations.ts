import { z } from "zod";
import {
  AssistantOwnerQuestionPresentSchema,
  AssistantOwnerQuestionSchema,
  type AssistantOwnerQuestion,
} from "../../../shared/model/assistantOwnerQuestions";
import type {
  AssistantRequest,
  AssistantResponse,
} from "../../../shared/model/host-contracts/assistant";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
const schema = z.strictObject({
  format: z.literal(1),
  environmentId: z.string().min(1).max(200),
  input: AssistantOwnerQuestionPresentSchema,
});
export type OwnerQuestionPresentation = z.infer<typeof schema>;
export type PresentationPort = (
  input: AssistantRequest,
  environmentId: string,
) => Promise<AssistantResponse>;
const prefix = "bycoda.assistant.question-presentation:",
  indexKey = (environmentId: string) => prefix + encodeURIComponent(environmentId) + ":pending";
const recordKey = (value: OwnerQuestionPresentation) =>
  prefix +
  encodeURIComponent(
    JSON.stringify([value.environmentId, value.input.threadId, value.input.requestId]),
  );
const errorText = "Saving this question is unconfirmed. Retry to verify the original card.";
export class OwnerQuestionPresentationPending extends Error {
  readonly presentation: OwnerQuestionPresentation;
  constructor(presentation: OwnerQuestionPresentation) {
    super(errorText);
    this.name = "OwnerQuestionPresentationPending";
    this.presentation = freeze(structuredClone(presentation));
  }
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function index(storage: Storage, environmentId: string): string[] {
  try {
    const value = JSON.parse(storage.getItem(indexKey(environmentId)) ?? "[]");
    return Array.isArray(value)
      ? value
          .filter((key): key is string => typeof key === "string" && key.startsWith(prefix))
          .slice(0, 20)
      : [];
  } catch {
    return [];
  }
}
export function pendingOwnerQuestionPresentations(
  storage: Storage,
  environmentId: string,
): OwnerQuestionPresentation[] {
  return index(storage, environmentId).flatMap((key) => {
    try {
      const raw = storage.getItem(key);
      if (!raw || raw.length > 128000) return [];
      const value = schema.parse(JSON.parse(raw));
      return value.environmentId === environmentId && recordKey(value) === key ? [value] : [];
    } catch {
      return [];
    }
  });
}
export function saveOwnerQuestionPresentation(storage: Storage, raw: OwnerQuestionPresentation) {
  const value = schema.parse(raw),
    key = recordKey(value),
    serialized = JSON.stringify(value);
  if (serialized.length > 128000)
    throw new Error("The question data could not be verified. Refresh its original Host.");
  try {
    const old = storage.getItem(key);
    if (old && JSON.stringify(schema.parse(JSON.parse(old))) !== serialized)
      throw new Error("changed");
    const keys = index(storage, value.environmentId);
    if (!keys.includes(key) && keys.length >= 20) throw new Error("capacity");
    storage.setItem(key, serialized);
    storage.setItem(indexKey(value.environmentId), JSON.stringify([...new Set([...keys, key])]));
  } catch {
    throw new Error(
      "The question draft could not be saved on this device. Keep this card open and retry.",
    );
  }
  return freeze(value);
}
export async function retryOwnerQuestionPresentation(
  value: OwnerQuestionPresentation,
  storage: Storage,
  request: PresentationPort,
  authorized: (projectIds: readonly string[]) => boolean,
): Promise<AssistantOwnerQuestion> {
  const captured = schema.parse(value),
    key = recordKey(captured),
    serialized = JSON.stringify(captured);
  const assert = () => {
    if (!authorized(captured.input.contextProjectIds))
      throw new Error(
        "The question's Host or project visibility changed. Keep the original draft.",
      );
  };
  assert();
  if (storage.getItem(key) !== serialized)
    throw new Error(
      "The saved question draft does not match its original question. Keep it and refresh the question.",
    );
  try {
    const result = await request(structuredClone(captured.input), captured.environmentId);
    assert();
    const question = AssistantOwnerQuestionSchema.parse(result.ownerQuestion),
      drafts = captured.input.questions;
    if (
      question.threadId !== captured.input.threadId ||
      question.ownerMessageId !== captured.input.ownerMessageId ||
      question.prompt.questions.length !== drafts.length ||
      !authorized(question.projectIds) ||
      question.prompt.questions.some((item, index) => {
        const draft = drafts[index];
        return (
          item.prompt !== draft.prompt.trim() ||
          item.multiSelect !== draft.multiSelect ||
          item.allowCustom !== draft.allowCustom ||
          item.options.length !== draft.options.length ||
          item.options.some(
            (option, n) =>
              option.label !== draft.options[n].label.trim() ||
              (option.description ?? "") !== (draft.options[n].description?.trim() ?? ""),
          )
        );
      })
    )
      throw new Error("unverified");
    // A cleanup failure cannot turn an acknowledged question into another creation.
    try {
      if (storage.getItem(key) === serialized) {
        storage.removeItem(key);
        storage.setItem(
          indexKey(captured.environmentId),
          JSON.stringify(index(storage, captured.environmentId).filter((item) => item !== key)),
        );
      }
    } catch {
      /* Exact intent remains recoverable; future retries use the same Host receipt. */
    }
    return question;
  } catch {
    throw new OwnerQuestionPresentationPending(captured);
  }
}
