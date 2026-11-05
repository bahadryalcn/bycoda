import type { ComponentProps } from "react";
import { QuestionForm } from "./QuestionForm";

type FormProps = ComponentProps<typeof QuestionForm>;
type Props = Omit<FormProps, "prompt" | "onReply"> & {
  question: FormProps["prompt"] | null | undefined;
  onReply: FormProps["onReply"] | undefined;
  remoteFeatures?: { questionAttachments?: boolean };
};

/** Keeps actual attachment custody separate from a logical draft namespace. */
export function ComposerQuestionForm({
  question,
  onReply,
  sessionId,
  draftScope,
  attachmentsSupported = true,
  remote,
  remoteFeatures,
  ...rest
}: Props) {
  if (!question || !onReply) return null;
  return (
    <QuestionForm
      {...rest}
      prompt={question}
      onReply={onReply}
      sessionId={sessionId}
      draftScope={draftScope ?? sessionId}
      remote={remote}
      attachmentsSupported={
        attachmentsSupported && (!remote || !!remoteFeatures?.questionAttachments)
      }
    />
  );
}
