import type { VoiceChoice } from "./voiceChoices";
import type { VoiceHistoryBinding } from "./voiceHistory";
import type { VoiceThreadTranscript } from "./voiceThreads";
import { type AssistantOwnerQuestion } from "../../../shared/model/assistantOwnerQuestions";
import {
  AssistantOwnerQuestionDraft,
  ownerQuestionPrompt,
} from "../../assistant/model/assistantOwnerQuestions";
import { CUSTOM_OPTION_ID, type UserQuestionReply } from "../../sessions/model/userQuestion";
import { t } from "../../../shared/i18n";
import {
  saveOwnerQuestionPresentation,
  retryOwnerQuestionPresentation,
  OwnerQuestionPresentationPending,
  type OwnerQuestionPresentation,
} from "../../assistant/model/assistantOwnerQuestionPresentations";
export type PersistedVoiceOwnerChoice = {
  choice: VoiceChoice;
  question: AssistantOwnerQuestion;
  answer(
    reply: UserQuestionReply,
  ): Promise<{ question: AssistantOwnerQuestion; reply: UserQuestionReply }>;
  retryAnswer(): Promise<{ question: AssistantOwnerQuestion; reply: UserQuestionReply }>;
  answeredReply(): UserQuestionReply;
  deferred(): { status: string; ownerQuestionId: string; threadId?: string };
};
export class VoiceOwnerChoicePending extends OwnerQuestionPresentationPending {
  constructor(
    presentation: OwnerQuestionPresentation,
    readonly choice: VoiceChoice,
    readonly retry: () => Promise<PersistedVoiceOwnerChoice>,
  ) {
    super(presentation);
  }
  deferred() {
    return {
      status: "presentation_unconfirmed",
      requestId: this.presentation.input.requestId,
      threadId: this.presentation.input.threadId,
    };
  }
}
function notify(environmentId: string) {
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent("bycoda:assistant-owner-questions-changed", { detail: { environmentId } }),
    );
}

/** Ordinary choice data only. Exact-operation confirmation brokers never enter this path. */
export async function persistVoiceOwnerChoice(
  original: VoiceChoice,
  history: VoiceHistoryBinding,
  transcript: VoiceThreadTranscript,
  current: () => boolean,
  causalContext?: Promise<string | undefined>,
): Promise<PersistedVoiceOwnerChoice | undefined> {
  if (original.kind === "confirm") return;
  original = structuredClone(original);
  if (history.remote || !history.environmentId)
    throw new Error(
      "Saved questions are unavailable for this voice Host. Keep voice open to answer.",
    );
  const assert = () => {
    if (!current() || history.current?.() === false)
      throw new Error("The voice question source changed before it could be saved.");
  };
  assert();
  const source = await transcript.ownerReceipt();
  assert();
  if (source.request !== history.request)
    throw new Error("The voice question belongs to another captured conversation.");
  const scope = await history.scope?.();
  assert();
  if (!scope?.complete || !scope.current())
    throw new Error("The voice question context could not be verified for saving.");
  const environmentId = await history.environmentId();
  assert();
  const causalContextId = await causalContext;
  if (causalContext && !causalContextId)
    throw new Error("The voice question context could not be verified for saving.");
  assert();
  const question = original.prompt.questions[0];
  const presentation = saveOwnerQuestionPresentation(localStorage, {
    format: 1,
    environmentId,
    input: {
      op: "questions.present",
      threadId: source.message.threadId,
      ownerMessageId: source.message.id,
      contextProjectIds: [...scope.projectIds],
      requestId: `voice-choice:${original.id}`,
      ...(causalContextId ? { causalContextId } : {}),
      questions: [
        {
          prompt: question.prompt,
          multiSelect: question.multiSelect,
          allowCustom: question.allowCustom,
          options: question.options.map((option) => ({
            label: option.label,
            ...(option.description?.trim() ? { description: option.description } : {}),
          })),
        },
      ],
    },
  });
  notify(environmentId);
  const complete = (canonical: AssistantOwnerQuestion): PersistedVoiceOwnerChoice => {
    assert();
    const saved = canonical.prompt.questions[0];
    if (
      canonical.threadId !== source.message.threadId ||
      canonical.ownerMessageId !== source.message.id ||
      canonical.prompt.questions.length !== 1 ||
      canonical.projectIds.some(
        (id) => !scope.projectIds.includes(id) || !scope.liveProjectIds().has(id),
      ) ||
      saved.multiSelect !== question.multiSelect ||
      saved.allowCustom !== question.allowCustom ||
      saved.prompt !== question.prompt.trim() ||
      saved.options.length !== question.options.length ||
      saved.options.some(
        (option, index) =>
          option.label !== question.options[index].label.trim() ||
          (option.description ?? "") !== (question.options[index].description?.trim() ?? ""),
      )
    )
      throw new Error("The saved question did not match its original choices.");
    const model = new AssistantOwnerQuestionDraft(
      canonical,
      environmentId,
      localStorage,
      () => crypto.randomUUID(),
      () => current() && history.current?.() !== false,
    );
    const choice: VoiceChoice = {
      ...original,
      id: canonical.id,
      prompt: ownerQuestionPrompt(canonical, t("Type your answer")),
      ownerQuestion: { question: canonical, environmentId },
    };
    const map = (value: AssistantOwnerQuestion): UserQuestionReply => {
      if (!value.answer) return { kind: "skipped" };
      const selected = value.answer.answers[saved.id] ?? [];
      return {
        kind: "answered",
        answers: {
          [question.id]: selected
            .map((id) =>
              id === CUSTOM_OPTION_ID
                ? id
                : question.options[saved.options.findIndex((option) => option.id === id)]?.id,
            )
            .filter((id): id is string => !!id),
        },
        ...(value.answer.custom?.[saved.id]
          ? { custom: { [question.id]: value.answer.custom[saved.id] } }
          : {}),
        ...(value.answer.notes?.[saved.id]
          ? { notes: { [question.id]: value.answer.notes[saved.id] } }
          : {}),
      };
    };
    return {
      choice,
      question: canonical,
      answeredReply: () => map(canonical),
      async retryAnswer() {
        const value = await model.retry((input, expected) => {
          if (expected !== environmentId) throw new Error("The captured question Host changed.");
          return history.request(input);
        });
        assert();
        return { question: value, reply: map(value) };
      },
      async answer(reply: UserQuestionReply) {
        const value = await model.submit(
          reply,
          (input, expected) => {
            if (expected !== environmentId) throw new Error("The captured question Host changed.");
            return history.request(input);
          },
          Date.now() + 3600000,
        );
        assert();
        return { question: value, reply: map(value) };
      },
      deferred: () => ({
        status: "awaiting_owner",
        ownerQuestionId: canonical.id,
        threadId: canonical.threadId,
      }),
    };
  };
  const send = async () => {
    try {
      return complete(
        await retryOwnerQuestionPresentation(
          presentation,
          localStorage,
          (input, expected) => {
            if (expected !== environmentId) throw new Error("The captured question Host changed.");
            return history.request(input);
          },
          (ids) =>
            current() &&
            history.current?.() !== false &&
            scope.current() &&
            ids.every((id) => scope.projectIds.includes(id) && scope.liveProjectIds().has(id)),
        ),
      );
    } catch (cause) {
      if (cause instanceof OwnerQuestionPresentationPending)
        throw new VoiceOwnerChoicePending(presentation, original, send);
      throw cause;
    } finally {
      notify(environmentId);
    }
  };
  return send();
}
