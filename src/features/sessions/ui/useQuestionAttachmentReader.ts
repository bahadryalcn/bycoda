import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { useT } from "../../../shared/i18n";
import type { Attachment } from "../model/session";
import { questionDraftKey, type QuestionDraft } from "../model/questionDrafts";
import type { UserQuestionPrompt } from "../model/userQuestion";
import type { UserQuestion } from "../../../shared/model/userQuestion";
import { MAX_ATTACHMENTS, revokeAttachment } from "../model/attachments";
import {
  pendingQuestionAttachment,
  prepareOwnedQuestionAttachments,
  prepareQuestionAttachments,
  questionAttachmentIdentity,
} from "../model/questionAttachments";

type Options = {
  canAttach: boolean;
  held: boolean;
  interact: () => void;
  attachmentFlight: MutableRefObject<boolean>;
  setReadingAttachments: Dispatch<SetStateAction<boolean>>;
  setAttachmentError: Dispatch<SetStateAction<string | null>>;
  parentChanged: {
    canMutate: () => boolean;
    admit: () => { apply: (run: () => void) => void; finish: () => void } | null;
  };
  draftRef: MutableRefObject<QuestionDraft>;
  mounted: MutableRefObject<boolean>;
  reservation: MutableRefObject<{ current: () => boolean } | undefined>;
  updateDraft: (change: (current: QuestionDraft) => QuestionDraft) => boolean;
  sessionId: string | undefined;
  draftScope: string | undefined;
  prompt: UserQuestionPrompt;
  question: UserQuestion;
  t: ReturnType<typeof useT>;
};

/** Reads picked, pasted or dropped files into the current question's draft. */
export function useQuestionAttachmentReader({
  canAttach,
  held,
  interact,
  attachmentFlight,
  setReadingAttachments,
  setAttachmentError,
  parentChanged,
  draftRef,
  mounted,
  reservation,
  updateDraft,
  sessionId,
  draftScope,
  prompt,
  question,
  t,
}: Options) {
  return (read: () => Promise<Attachment[]>) => {
    if (!canAttach || held || attachmentFlight.current || !parentChanged.canMutate()) return;
    const admission = parentChanged.admit();
    if (!admission) return;
    interact();
    attachmentFlight.current = true;
    setReadingAttachments(true);
    setAttachmentError(null);
    void (async () => {
      let incoming: Attachment[] = [];
      try {
        incoming = await read();
        if (
          Object.values(draftRef.current.attachments ?? {}).flat().length + incoming.length >
          MAX_ATTACHMENTS
        )
          throw new Error(t("A message carries up to {p0} attachments.", { p0: MAX_ATTACHMENTS }));
        if (!sessionId && incoming.some((file) => !file.path?.trim()))
          throw new Error(t("Question attachment session identity is unavailable"));
        const pending = sessionId
          ? incoming.map((file) =>
              pendingQuestionAttachment(
                file,
                questionDraftKey(draftScope, prompt),
                sessionId,
                questionAttachmentIdentity(prompt, question.id),
              ),
            )
          : [];
        let staged = !sessionId;
        if (sessionId)
          admission.apply(() => {
            staged = updateDraft((current) => ({
              ...current,
              attachments: {
                ...current.attachments,
                [question.id]: [...(current.attachments?.[question.id] ?? []), ...pending],
              },
            }));
          });
        if (!staged) return;
        const prepared = sessionId
          ? await prepareOwnedQuestionAttachments(incoming, pending, (error) => {
              if (mounted.current)
                setAttachmentError(String(error instanceof Error ? error.message : error));
            })
          : await prepareQuestionAttachments(incoming);
        admission.apply(() => {
          if (!mounted.current || !reservation.current?.current()) return;
          updateDraft((current) => ({
            ...current,
            attachments: {
              ...current.attachments,
              [question.id]: sessionId
                ? (current.attachments?.[question.id] ?? []).map(
                    (file) => prepared.find((item) => item.id === file.id) ?? file,
                  )
                : [...(current.attachments?.[question.id] ?? []), ...prepared],
            },
          }));
        });
      } catch (error) {
        if (mounted.current)
          setAttachmentError(String(error instanceof Error ? error.message : error));
      } finally {
        incoming.forEach(revokeAttachment);
        attachmentFlight.current = false;
        if (mounted.current) setReadingAttachments(false);
        admission.finish();
      }
    })();
  };
}
