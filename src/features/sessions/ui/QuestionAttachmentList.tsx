import type { QuestionDraftAttachment } from "../model/questionAttachments";
import type { QuestionDraft } from "../model/questionDrafts";
import { runQuestionAttachmentEffect } from "../model/questionAttachments";
import { AttachmentChip } from "./AttachmentChip";

export function QuestionAttachmentList({ files, held, questionId, update, busy, error, flight }: {
  files: QuestionDraftAttachment[];
  held: boolean;
  questionId: string;
  update: (change: (current: QuestionDraft) => QuestionDraft) => boolean;
  busy: (value: boolean) => void;
  error: (value: string | null) => void;
  flight: { current: boolean };
}) {
  return files.map((file) => (
    <AttachmentChip
      key={file.id}
      attachment={file}
      onRemove={held ? undefined : () => runQuestionAttachmentEffect(
        [file], "release", () => update((current) => ({
          ...current,
          attachments: {
            ...current.attachments,
            [questionId]: (current.attachments?.[questionId] ?? []).filter((item) => item.id !== file.id),
          },
        })), busy, error, flight,
      )}
    />
  ));
}
