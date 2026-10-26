/** Shared clarifying-question model for every harness that can ask the user. */

export const CUSTOM_OPTION_ID = "__custom__";

export type UserQuestionOption = {
  id: string;
  label: string;
  description?: string;
  /** Literal schema value; labels such as Other must not become a free-text option. */
  literal?: boolean;
};

export type UserQuestion = {
  id: string;
  header?: string;
  prompt: string;
  multiSelect: boolean;
  allowCustom: boolean;
  /** Typed form text is a value, including meaningful leading/trailing spaces. */
  preserveCustomWhitespace?: boolean;
  options: UserQuestionOption[];
};

/** Provider-owned execution semantics; omission means the provider did not report it. */
export type UserQuestionBehavior = "blocking" | "nonBlocking";
export type UserQuestionDelivery = "sending" | "queued" | "failed" | "unknown";
export type UserQuestionDismissAction = "skip" | "cancel" | "decline";

export type UserQuestionPrompt = {
  requestId: number;
  title?: string;
  questions: UserQuestion[];
  behavior?: UserQuestionBehavior;
  dismissAction?: UserQuestionDismissAction;
  providerTurnId?: string;
  callId?: string;
  /** Transport state, never a claim that the model consumed the answer. */
  delivery?: UserQuestionDelivery;
  error?: string;
  /** Deadline owned by the harness; interaction can disable automatic skipping. */
  autoResolveAt?: number;
};

export type UserQuestionReply =
  | {
      kind: "answered";
      answers: Record<string, string[]>;
      custom?: Record<string, string>;
    }
  | { kind: "skipped" };

export function questionsFromUnknown(value: unknown): UserQuestion[] {
  const rec = asRecord(value);
  const nested = asRecord(rec?.input) ?? asRecord(rec?.params) ?? asRecord(rec?.question);
  const raw = firstArray(
    rec?.questions,
    nested?.questions,
    Array.isArray(value) ? value : undefined,
  );
  const usedIds = new Set<string>();
  return raw.flatMap((item, index) => {
    const parsed = questionFromUnknown(item, index, usedIds);
    return parsed ? [parsed] : [];
  });
}

export function questionPromptTitle(questions: UserQuestion[]): string {
  const first = questions[0];
  return first?.header || first?.prompt || "Question";
}

export function questionIsComplete(
  question: UserQuestion,
  answers: Record<string, string[]>,
  custom: Record<string, string> = {},
): boolean {
  const selected = answers[question.id] ?? [];
  if (selected.length === 0) {
    return (
      question.allowCustom &&
      !!(question.preserveCustomWhitespace ? custom[question.id] : custom[question.id]?.trim())
    );
  }
  if (!question.multiSelect && selected.length !== 1) return false;
  return selected.every((id) => {
    if (!isCustomSelection(question, id)) return true;
    return !!(question.preserveCustomWhitespace
      ? custom[question.id]
      : custom[question.id]?.trim());
  });
}

export function questionAnswersComplete(
  questions: UserQuestion[],
  answers: Record<string, string[]>,
  custom: Record<string, string> = {},
): boolean {
  if (questions.length === 0) return false;
  return questions.every((question) => questionIsComplete(question, answers, custom));
}

/** Skip every question → skipped. Any answered question → answered with those only. */
export function buildQuestionReply(
  questions: UserQuestion[],
  answers: Record<string, string[]>,
  custom: Record<string, string> = {},
): UserQuestionReply {
  const answered = questions.filter((question) => questionIsComplete(question, answers, custom));
  if (answered.length === 0) return { kind: "skipped" };
  const nextAnswers: Record<string, string[]> = {};
  const nextCustom: Record<string, string> = {};
  for (const question of answered) {
    const selected = answers[question.id];
    if (selected?.length) nextAnswers[question.id] = selected;
    const text = question.preserveCustomWhitespace
      ? custom[question.id]
      : custom[question.id]?.trim();
    if (text) nextCustom[question.id] = text;
  }
  return {
    kind: "answered",
    answers: nextAnswers,
    ...(Object.keys(nextCustom).length > 0 ? { custom: nextCustom } : {}),
  };
}

export function selectedAnswerLabels(
  question: UserQuestion,
  reply: Extract<UserQuestionReply, { kind: "answered" }>,
): string[] {
  const custom = question.preserveCustomWhitespace
    ? reply.custom?.[question.id]
    : reply.custom?.[question.id]?.trim();
  const selected = reply.answers[question.id] ?? [];
  if (selected.length === 0 && custom && question.allowCustom) return [custom];
  return selected.flatMap((id) => {
    if (isCustomSelection(question, id)) return custom ? [custom] : [];
    const option = question.options.find((item) => item.id === id);
    const label = option?.label.trim() || id.trim();
    return label ? [label] : [];
  });
}

export function isCustomSelection(question: UserQuestion, optionId: string): boolean {
  if (optionId === CUSTOM_OPTION_ID) return true;
  const option = question.options.find((item) => item.id === optionId);
  return option ? isOtherOption(option) : false;
}

export function isOtherOption(option: UserQuestionOption): boolean {
  return (
    option.id === CUSTOM_OPTION_ID ||
    (option.literal !== true && /^other$/i.test(option.label.trim()))
  );
}

function questionFromUnknown(
  value: unknown,
  index: number,
  usedIds: Set<string>,
): UserQuestion | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const prompt =
    stringField(rec, "question") ??
    stringField(rec, "prompt") ??
    stringField(rec, "text") ??
    stringField(rec, "header");
  const options = optionsFromUnknown(rec.options);
  const allowCustom = customAllowed(rec, options);
  if (!prompt && options.length === 0 && !allowCustom) return null;
  const header = stringField(rec, "header") ?? stringField(rec, "title");
  return {
    id: uniqueId(stringField(rec, "id") ?? prompt ?? header ?? `q${index + 1}`, usedIds),
    ...(header ? { header } : {}),
    prompt: prompt || header || `Question ${index + 1}`,
    multiSelect: rec.multiSelect === true || rec.allowMultiple === true || rec.multiple === true,
    allowCustom,
    ...(rec.preserveCustomWhitespace === true ? { preserveCustomWhitespace: true } : {}),
    options,
  };
}

function optionsFromUnknown(value: unknown): UserQuestionOption[] {
  if (!Array.isArray(value)) return [];
  const usedIds = new Set<string>();
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) {
      const label = item.trim();
      return [{ id: uniqueId(label, usedIds), label }];
    }
    const rec = asRecord(item);
    if (!rec) return [];
    const label =
      stringField(rec, "label") ??
      stringField(rec, "value") ??
      stringField(rec, "text") ??
      stringField(rec, "id");
    if (!label) return [];
    const description = stringField(rec, "description") ?? stringField(rec, "detail");
    return [
      {
        id: uniqueId(
          stringField(rec, "id") ??
            stringField(rec, "optionId") ??
            stringField(rec, "value") ??
            label,
          usedIds,
        ),
        label,
        ...(description ? { description } : {}),
        ...(rec.literal === true ? { literal: true } : {}),
      },
    ];
  });
}

function customAllowed(rec: Record<string, unknown>, options: UserQuestionOption[]): boolean {
  if (typeof rec.custom === "boolean") return rec.custom;
  if (typeof rec.allowCustom === "boolean") return rec.allowCustom;
  if (options.some(isOtherOption)) return true;
  // Cursor-style options carry stable ids; Claude/OpenCode/Grok add Other in the UI.
  if (stringField(rec, "prompt") && !stringField(rec, "question")) return false;
  return true;
}

function uniqueId(seed: string, used: Set<string>): string {
  const base = seed.trim() || "option";
  let next = base;
  let n = 2;
  while (used.has(next)) {
    next = `${base}:${n}`;
    n += 1;
  }
  used.add(next);
  return next;
}

function firstArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function stringField(
  rec: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  if (!rec) return undefined;
  const value = rec[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
