import {
  CUSTOM_OPTION_ID,
  type UserQuestion,
  type UserQuestionReply,
} from "../../../../shared/model/userQuestion";

export function cursorAskQuestionResponse(
  reply: UserQuestionReply,
  questions: UserQuestion[],
): Record<string, unknown> {
  if (reply.kind !== "answered") return { outcome: { outcome: "skipped", reason: "User skipped" } };
  if (reply.notes && Object.keys(reply.notes).length)
    throw new Error("Question notes are not supported by Cursor fixed-choice questions.");
  return {
    outcome: {
      outcome: "answered",
      answers: questions.map((question) => ({
        questionId: question.id,
        selectedOptionIds: (reply.answers[question.id] ?? []).filter(
          (id) => id !== CUSTOM_OPTION_ID,
        ),
      })),
    },
  };
}
