import { z } from "zod";
import type { UserQuestionPrompt, UserQuestionReply } from "../../sessions/model/userQuestion";
import type { AssistantOwnerQuestion } from "../../../shared/model/assistantOwnerQuestions";

const choiceInput = z.strictObject({
  question: z.string().trim().min(1).max(1000),
  options: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(80),
        label: z.string().min(1).max(200),
        description: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(9),
  kind: z.enum(["disambiguation", "confirm", "pick", "jobList"]).default("pick"),
  multiSelect: z.boolean().default(false),
  allowCustom: z.boolean().default(true),
  timeoutSec: z.number().int().min(10).max(600).default(120),
});
export type VoiceChoice = {
  id: string;
  prompt: UserQuestionPrompt;
  timeoutSec: number;
  kind: z.infer<typeof choiceInput>["kind"];
  presentationPending?: boolean;
  ownerQuestion?: { question: AssistantOwnerQuestion; environmentId: string };
};
export function parseVoiceChoice(input: unknown): VoiceChoice {
  const value = choiceInput.parse(input);
  if (value.options.some((option) => option.id === "__custom__"))
    throw new Error("Choice ID is reserved.");
  if (new Set(value.options.map((option) => option.id)).size !== value.options.length)
    throw new Error("Choice IDs must be unique.");
  return {
    id: crypto.randomUUID(),
    kind: value.kind,
    timeoutSec: value.timeoutSec,
    prompt: {
      requestId: Math.floor(Math.random() * 2_000_000_000),
      questions: [
        {
          id: "choice",
          prompt: value.question,
          options: value.options,
          multiSelect: value.multiSelect,
          allowCustom: value.allowCustom,
        },
      ],
    },
  };
}
export function spokenVoiceChoice(
  choice: VoiceChoice,
  text: string,
): UserQuestionReply | undefined {
  const normalized = text
    .trim()
    .toLocaleLowerCase()
    .replace(/[.!?]$/g, "");
  const question = choice.prompt.questions[0];
  if (choice.kind === "confirm") {
    const id = /^(yes|confirm|approve|evet|onayla|tamam)$/iu.test(normalized)
      ? "confirm"
      : /^(no|cancel|hayır|iptal)$/iu.test(normalized)
        ? "cancel"
        : undefined;
    if (id && question.options.some((option) => option.id === id))
      return { kind: "answered", answers: { choice: [id] } };
  }
  if (question.multiSelect) {
    const parts = text.split(/\s*(?:,|\band\b|\bve\b)\s*/i);
    if (parts.length > 1) {
      const single = {
        ...choice,
        prompt: { ...choice.prompt, questions: [{ ...question, multiSelect: false }] },
      };
      const matches = parts.map((part) => spokenVoiceChoice(single, part));
      if (
        matches.every(
          (answer): answer is Extract<UserQuestionReply, { kind: "answered" }> =>
            answer?.kind === "answered",
        )
      )
        return {
          kind: "answered",
          answers: {
            [question.id]: [...new Set(matches.flatMap((answer) => answer.answers[question.id]))],
          },
        };
      return;
    }
  }
  const ordinals = [
    ["1", "first", "the first one", "bir", "birinci", "ilki"],
    ["2", "second", "the second one", "iki", "ikinci", "ikincisi"],
    ["3", "third", "the third one", "üç", "üçüncü", "üçüncüsü"],
  ];
  const matched = question.options.filter(
    (option, index) =>
      option.label.toLocaleLowerCase() === normalized ||
      option.id.toLocaleLowerCase() === normalized ||
      ordinals[index]?.includes(normalized) ||
      String(index + 1) === normalized,
  );
  if (matched.length !== 1) return;
  return { kind: "answered", answers: { [question.id]: [matched[0].id] } };
}
export function validVoiceChoiceReply(
  choice: VoiceChoice,
  reply: unknown,
): reply is UserQuestionReply {
  if (!reply || typeof reply !== "object") return false;
  const value = reply as UserQuestionReply;
  if (value.kind === "skipped") return true;
  const key = choice.prompt.questions[0].id;
  if (
    value.kind !== "answered" ||
    !value.answers ||
    Object.keys(value.answers).some((name) => name !== key)
  )
    return false;
  const question = choice.prompt.questions[0];
  const answers = value.answers[key] ?? [];
  if (
    !Array.isArray(answers) ||
    answers.some(
      (id) =>
        typeof id !== "string" ||
        (!question.options.some((option) => option.id === id) &&
          !(question.allowCustom && id === "__custom__")),
    )
  )
    return false;
  const custom = value.custom?.[key];
  if (
    answers.includes("__custom__") &&
    !(question.allowCustom && typeof custom === "string" && custom.trim() && custom.length <= 4000)
  )
    return false;
  return answers.length > 0
    ? question.multiSelect || answers.length === 1
    : question.allowCustom &&
        typeof custom === "string" &&
        Boolean(custom.trim()) &&
        custom.length <= 4000;
}
