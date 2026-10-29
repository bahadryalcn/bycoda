import type { UserQuestionPrompt } from "./userQuestion";
import { registerParentInput, canPublishParentInput } from "../data/parentInputClosure";

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
// session snapshots or ordinary draft storage after the question is gone.
// Explicit private Native checkpoint retention is data-only, never restoration
// of an unanswered question or permission to send a provider decision.
const drafts = new Map<string, QuestionDraft>();
const associations = new Map<
  string,
  {
    sessionId?: string;
    prompt: UserQuestionPrompt;
    scope: string;
    mounts: number;
    ambiguous?: boolean;
    binding?: ReturnType<typeof registerParentInput>;
  }
>();
const MAX_DRAFTS = 64;

/** The mounted owner supplies a logical session separately from the cache key. */
export function associateQuestionDraft(
  scope: string | undefined,
  prompt: UserQuestionPrompt,
  sessionId: string | undefined,
): (() => void) | undefined {
  if (!scope || !sessionId) return;
  const key = questionDraftKey(scope, prompt);
  const existing = associations.get(key);
  if (existing?.ambiguous) return;
  if (existing?.sessionId && existing.sessionId !== sessionId) {
    // A reused cache namespace cannot retarget retained data to another root.
    existing.binding?.release();
    existing.binding = undefined;
    existing.sessionId = undefined;
    existing.ambiguous = true;
    if (drafts.has(key)) registerRetained(key);
    return;
  }
  if (existing?.sessionId === sessionId) {
    existing.prompt = prompt;
    existing.binding?.changed();
  } else {
    existing?.binding?.release();
    associations.set(key, { sessionId, prompt, scope, mounts: 0 });
  }
  if (drafts.has(key)) registerRetained(key);
  const owner = associations.get(key);
  if (owner) owner.mounts++;
  let released = false;
  return () => {
    if (released || !owner) return;
    released = true;
    owner.mounts--;
    if (!owner.mounts && !drafts.has(key) && associations.get(key) === owner)
      associations.delete(key);
  };
}

function registerRetained(key: string) {
  const owner = associations.get(key);
  if (!owner || owner.binding) return;
  owner.binding = registerParentInput({
    kind: "question-draft",
    sessionId: owner.sessionId,
    snapshot: () => ({
      source: "retained-question-draft",
      draftScope: owner.scope,
      questionKey: key,
      prompt: owner.prompt,
      draft: drafts.get(key),
    }),
    missingCoverage: ["decision-conservation"],
  });
}

function forget(key: string) {
  drafts.delete(key);
  const owner = associations.get(key);
  owner?.binding?.release();
  if (owner) owner.binding = undefined;
  if (!owner?.mounts) associations.delete(key);
}

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
  external = false,
): void {
  if (!scope) return;
  const key = questionDraftKey(scope, prompt);
  if (!external && !canPublishParentInput(associations.get(key)?.sessionId)) return;
  drafts.delete(key);
  drafts.set(key, draft);
  if (!associations.has(key)) associations.set(key, { prompt, scope, mounts: 0 });
  registerRetained(key);
  associations.get(key)?.binding?.changed();
  if (drafts.size > MAX_DRAFTS) forget(drafts.keys().next().value!);
}

export function discardQuestionDraft(scope: string, prompt: UserQuestionPrompt): void {
  forget(questionDraftKey(scope, prompt));
}
