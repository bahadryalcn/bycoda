import type { UserQuestionPrompt } from "./userQuestion";

export type QuestionDraft = {
  step: number;
  answers: Record<string, string[]>;
  custom: Record<string, string>;
  /** Local dispatch may outlive the mounted form, before provider state arrives. */
  delivery?: "sending" | "unknown";
  /** Keep pending feedback on the initiating control across form remounts. */
  pendingAction?: "answer" | "dismiss";
};

// Keep unfinished answers local to this renderer. They must not enter remote
// session snapshots or survive on disk after the question is gone.
const drafts = new Map<string, QuestionDraft>();
const MAX_DRAFTS = 64;

export function questionDraftKey(scope: string | undefined, prompt: UserQuestionPrompt): string {
  return JSON.stringify([
    scope ?? null,
    prompt.providerTurnId ?? null,
    prompt.callId ?? null,
    prompt.requestId,
    prompt.questions.map((question) => [
      question.id,
      question.prompt,
      question.multiSelect,
      question.allowCustom,
      question.options.map((option) => [option.id, option.label]),
    ]),
  ]);
}

export function readQuestionDraft(
  scope: string | undefined,
  prompt: UserQuestionPrompt,
): QuestionDraft | undefined {
  if (!scope) return undefined;
  return drafts.get(questionDraftKey(scope, prompt));
}

export function writeQuestionDraft(
  scope: string | undefined,
  prompt: UserQuestionPrompt,
  draft: QuestionDraft,
): void {
  if (!scope) return;
  const key = questionDraftKey(scope, prompt);
  drafts.delete(key);
  drafts.set(key, draft);
  if (drafts.size > MAX_DRAFTS) drafts.delete(drafts.keys().next().value!);
}

export function discardQuestionDraft(scope: string, prompt: UserQuestionPrompt): void {
  drafts.delete(questionDraftKey(scope, prompt));
}
