import type { UserQuestionPrompt } from "../model/userQuestion";
import type { QuestionDraftFailure } from "../model/questionDrafts";
import {
  ArrowUp,
  ChevronRight,
  CircleAlert,
  CircleX,
  Clock,
  CornerDownRight,
  MessageSquare,
  Play,
  RefreshCw,
  X,
} from "../../../shared/ui/icons";
import type { useT } from "../../../shared/i18n";

type Input = {
  t: ReturnType<typeof useT>;
  prompt: UserQuestionPrompt;
  sending: boolean;
  localUnknown: boolean;
  draftDelivery: string | undefined;
  pendingAction: string | undefined;
  capacityIssue: QuestionDraftFailure | undefined;
  last: boolean;
};

/** Status line, icons and button labels for a question form's current state. */
export function questionFormPresentation({
  t,
  prompt,
  sending,
  localUnknown,
  draftDelivery,
  pendingAction,
  capacityIssue,
  last,
}: Input) {
  const queued = prompt.delivery === "queued";
  const uncertain =
    !queued &&
    (prompt.delivery === "unknown" ||
      localUnknown ||
      draftDelivery === "unknown" ||
      capacityIssue === "pending");
  const capacityMessage =
    capacityIssue === "capacity"
      ? t(
          "Question capacity is full. Your saved answers are kept. Resolve or discard another question to continue.",
        )
      : capacityIssue === "size"
        ? t("This question or answer is too large to keep locally. Your previous answer is kept.")
        : capacityIssue && capacityIssue !== "pending" && capacityIssue !== "closed"
          ? t("Question state changed. Your saved answer is kept.")
          : undefined;
  const failed = !sending && prompt.delivery === "failed";
  const dismissing = sending && pendingAction === "dismiss";
  const pendingLabel = dismissing
    ? prompt.dismissAction === "cancel"
      ? t("Cancelling…")
      : t("Sending…")
    : t("Sending answer…");
  const status =
    prompt.delivery === "queued"
      ? t("Answer saved · waiting to continue")
      : uncertain
        ? prompt.error
          ? t(prompt.error)
          : t(
              "Answer delivery could not be confirmed. Wait for the connection to recover before sending again.",
            )
        : sending
          ? pendingLabel
          : failed
            ? prompt.error
              ? t(prompt.error)
              : t("Answer was not sent. Your answer is kept; try again.")
            : prompt.behavior === "blocking"
              ? t("Waiting for your answer")
              : prompt.behavior === "nonBlocking"
                ? t("Work may continue while this question is open")
                : t("Question open");
  const StatusIcon =
    uncertain || failed
      ? CircleAlert
      : sending || queued || prompt.behavior === "blocking"
        ? Clock
        : prompt.behavior === "nonBlocking"
          ? Play
          : MessageSquare;
  const DismissIcon =
    prompt.dismissAction === "cancel"
      ? X
      : prompt.dismissAction === "decline"
        ? CircleX
        : CornerDownRight;
  const SubmitIcon = uncertain
    ? CircleAlert
    : queued
      ? Clock
      : !last
        ? ChevronRight
        : failed
          ? RefreshCw
          : ArrowUp;
  const submitLabel = queued
    ? t("Waiting")
    : uncertain
      ? t("Connection issue")
      : sending && !dismissing
        ? pendingLabel
        : !last
          ? t("Next")
          : failed
            ? t("Send again")
            : t("Send answer");

  return {
    uncertain,
    capacityMessage,
    failed,
    dismissing,
    pendingLabel,
    status,
    StatusIcon: StatusIcon,
    DismissIcon: DismissIcon,
    SubmitIcon: SubmitIcon,
    submitLabel,
  };
}
