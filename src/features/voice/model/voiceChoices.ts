import { z } from "zod";
import type { UserQuestionPrompt, UserQuestionReply } from "../../sessions/model/userQuestion";
import type { AssistantOwnerQuestion } from "../../../shared/model/assistantOwnerQuestions";
import { normalizeVoiceSearch } from "./voiceFeatureLexicon";

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
  const exact = question.options.filter(
    (option) =>
      option.label.toLocaleLowerCase() === normalized ||
      option.id.toLocaleLowerCase() === normalized,
  );
  if (exact.length === 1) return { kind: "answered", answers: { [question.id]: [exact[0].id] } };
  if (exact.length > 1) return;
  const spoken = words(text);
  if (spoken.length === 1 && SKIP.has(spoken[0])) return { kind: "skipped" };
  const id = looseChoiceId(question.options, text);
  return id ? { kind: "answered", answers: { [question.id]: [id] } } : undefined;
}

const MAX_SPOKEN_WORDS = 8;
const NEGATION = new Set(
  "hayir yok istemiyorum istemem istemiyoruz vazgec vazgectim iptal cancel no nope not none dont don degil hicbiri hicbir never stop dur olmasin".split(
    " ",
  ),
);
// Words that only point at an option ("open it", "the second one", "pac-man'e"); any other
// leftover word, such as a work verb, means the speech is a new request and not an answer.
const FILLER = new Set(
  "the one ones please lutfen option choice number num numara numarali numarasi secenek secenegi olan olani sec seciyorum secelim ac acilsin acalim open use in to project proje projesi projesine projeye projesinde projede with for icin ile ben istiyorum olsun tamam evet yes ok okay go ahead pick choose select e a i u ye ya yi yu de da te ta den dan ni nu ne na nin nun".split(
    " ",
  ),
);
const SKIP = new Set(["gec", "skip", "atla", "pas"]);
const ORDINAL_BASES = [
  "birinci|first|ilk",
  "ikinci|second",
  "ucuncu|third",
  "dorduncu|fourth",
  "besinci|fifth",
  "altinci|sixth",
  "yedinci|seventh",
  "sekizinci|eighth",
  "dokuzuncu|ninth",
  "onuncu|tenth",
];
const ORDINAL_ENDING = "(?:s[iu]|sini|sunu|y[iu]|n[iu]|[iu]|y?[ea]|n?in|n?un|d[ea]n|ini)?";
const ORDINALS = ORDINAL_BASES.map(
  (bases) => new RegExp(`^(?:${bases})${bases.includes("ilk") ? "(?:i|ini)?" : ORDINAL_ENDING}$`),
);
const CARDINALS = [
  "bir|one",
  "iki|two",
  "uc|three",
  "dort|four",
  "bes|five",
  "alti|six",
  "yedi|seven",
  "sekiz|eight",
  "dokuz|nine",
  "on|ten",
].map((words) => new RegExp(`^(?:${words})$`));
const LAST = /^(?:son|sonuncu(?:s[iu]|yu|su|nu)?|last)$/;
const NAME_SUFFIX = /^(?:e|a|i|u|ye|ya|yi|yu|de|da|te|ta|den|dan|ni|nu|ne|na|nin|nun|si|su)?$/;

function words(value: string): string[] {
  return normalizeVoiceSearch(value).match(/[\p{L}\p{N}]+/gu) ?? [];
}
function ordinalIndex(word: string, count: number): number | undefined {
  if (LAST.test(word)) return count - 1;
  if (/^\d{1,2}$/.test(word)) return Number(word) - 1;
  const ordinal = ORDINALS.findIndex((pattern) => pattern.test(word));
  if (ordinal >= 0) return ordinal;
  const cardinal = CARDINALS.findIndex((pattern) => pattern.test(word));
  return cardinal >= 0 ? cardinal : undefined;
}
/** Same name token, allowing a Turkish case suffix on the spoken one ("pacman" + "e"). */
function sameName(spoken: string, label: string): boolean {
  return spoken.startsWith(label) && NAME_SUFFIX.test(spoken.slice(label.length));
}
function looseChoiceId(
  options: Array<{ id: string; label: string }>,
  text: string,
): string | undefined {
  const spoken = words(text);
  if (spoken.length === 0 || spoken.length > MAX_SPOKEN_WORDS) return;
  if (spoken.some((word) => NEGATION.has(word))) return;
  const core = spoken.filter((word) => !FILLER.has(word));
  if (core.length === 0) return;
  if (core.length === 1) {
    const index = ordinalIndex(core[0], options.length);
    if (index !== undefined)
      return index >= 0 && index < options.length ? options[index].id : undefined;
  }
  const whole: string[] = [];
  const leading: string[] = [];
  for (const option of options) {
    for (const [phrase, label] of [
      [core, words(option.label).filter((word) => !FILLER.has(word))],
      [spoken, words(option.label)],
    ]) {
      if (label.length === 0) continue;
      const joinedPhrase = phrase.join("");
      const joinedLabel = label.join("");
      if (sameName(joinedPhrase, joinedLabel)) {
        whole.push(option.id);
        break;
      }
      if (
        phrase.length < label.length &&
        joinedPhrase.length >= 2 &&
        phrase.every((word, index) =>
          index === phrase.length - 1 ? sameName(word, label[index]) : word === label[index],
        )
      ) {
        leading.push(option.id);
        break;
      }
    }
  }
  const found = whole.length > 0 ? whole : leading;
  return found.length === 1 ? found[0] : undefined;
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
