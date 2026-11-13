import type { AssistantProfilePatch } from "../../../shared/model/host-contracts/assistant";
import {
  AssistantProfileProposalSchema,
  type AssistantBuilderTurn,
  type AssistantProfileProposal,
} from "../../../shared/model/host-contracts/assistant-builder";
import { formatNumber, t } from "../../../shared/i18n";

export type BuilderFieldKey = keyof AssistantProfileProposal;

/** The interview contract allows 30 turns and 2000 characters per turn. */
export const BUILDER_MAX_TURNS = 30;
export const BUILDER_MAX_TURN_TEXT = 2000;

/** Appends one turn, keeping only the newest `BUILDER_MAX_TURNS` so a long interview stays valid. */
export function appendBuilderTurn(
  transcript: readonly AssistantBuilderTurn[],
  turn: AssistantBuilderTurn,
): AssistantBuilderTurn[] {
  const text = turn.text.trim().slice(0, BUILDER_MAX_TURN_TEXT);
  if (!text) return [...transcript];
  return [...transcript, { role: turn.role, text }].slice(-BUILDER_MAX_TURNS);
}

/** The draft's proposable fields, so the model sees what is decided. Invalid stored values are left out. */
export function proposalFromDraft(draft: AssistantProfilePatch): AssistantProfileProposal {
  const shape = AssistantProfileProposalSchema.shape;
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(shape) as BuilderFieldKey[]) {
    const value = draft[key];
    if (value !== undefined && shape[key].safeParse(value).success) picked[key] = value;
  }
  return picked as AssistantProfileProposal;
}

const hour = (value: number) => `${String(value).padStart(2, "0")}:00`;
const count = (value: number) => formatNumber(value);
const tokens = (value: number) => `${count(value)} ${t("tokens")}`;
const percent = (value: number) => `${count(value)}%`;
const minutes = (value: number) => t("{p0} min", { p0: value });
const yesNo = (value: boolean) => (value ? t("Yes") : t("No"));

function languageName(value: string): string {
  if (value === "auto") return t("Auto");
  try {
    return new Intl.DisplayNames([value], { type: "language" }).of(value) ?? value;
  } catch {
    return value;
  }
}

const notify = (value: "all" | "urgent" | "none") =>
  value === "all" ? t("All updates") : value === "urgent" ? t("Urgent only") : t("None");

type FieldDef = {
  key: BuilderFieldKey;
  label: () => string;
  /** Text for a stored or proposed value of this field. */
  format: (value: never) => string;
};

/** Defined with a helper so each formatter is checked against its own field's type. */
const field = <K extends BuilderFieldKey>(
  key: K,
  label: () => string,
  format: (value: NonNullable<AssistantProfileProposal[K]>) => string,
): FieldDef => ({ key, label, format: format as FieldDef["format"] });

/** Order is the order of the preview list. Labels are the ones the settings controls already use. */
const FIELDS: readonly FieldDef[] = [
  field(
    "name",
    () => t("Assistant name"),
    (v) => v,
  ),
  field(
    "addressAs",
    () => t("How should I address you?"),
    (v) => v,
  ),
  field(
    "addressFrequency",
    () => t("How often to use your name"),
    (v) => (v === "always" ? t("Always") : v === "never" ? t("Never") : t("Sometimes")),
  ),
  field("showTitle", () => t("Show title"), yesNo),
  field("language", () => t("Language"), languageName),
  field(
    "tone",
    () => t("Tone"),
    (v) =>
      v === "friendly"
        ? t("Friendly")
        : v === "neutral"
          ? t("Neutral")
          : v === "formal"
            ? t("Formal")
            : v === "casual"
              ? t("Casual")
              : t("Blunt"),
  ),
  field("allowProfanity", () => t("Allow profanity"), yesNo),
  field(
    "persona",
    () => t("Persona"),
    (v) => v,
  ),
  field("voiceNarration", () => t("Speak job updates while voice is connected"), yesNo),
  field(
    "proactiveSpeech",
    () => t("Start a conversation"),
    (v) =>
      v === "never"
        ? t("Never")
        : v === "return"
          ? t("Only when I return")
          : t("Also for important events"),
  ),
  field("confirmJobs", () => t("Confirm jobs before starting"), yesNo),
  field("allowRoutineQuestions", () => t("Answer routine worker questions"), yesNo),
  field(
    "planApproval",
    () => t("Plan approval"),
    (v) => (v === "always" ? t("Always") : v === "large" ? t("Big jobs only") : t("Never")),
  ),
  field(
    "dailyTokenBudget",
    () => t("Daily token budget"),
    (v) => `${tokens(v)}/${t("day")}`,
  ),
  field("perWakeTokenCap", () => t("Review reservation"), tokens),
  field(
    "chiefWakeLimit",
    () => t("Supervisor reviews"),
    (v) => `${count(v)}/${t("hour")}`,
  ),
  field("nudgeLimit", () => t("Follow-ups"), count),
  field(
    "summaryRefreshMessages",
    () => t("Summary every"),
    (v) => `${count(v)} ${t("messages")}`,
  ),
  field("chiefSoftContext", () => t("Compact at"), tokens),
  field("chiefHardContext", () => t("Renew at"), tokens),
  field("workerSoftContext", () => t("Worker compact at"), tokens),
  field("workerHardContext", () => t("Worker fresh session at"), tokens),
  field("workerCompactPercent", () => t("Worker compact at"), percent),
  field("workerHandoffPercent", () => t("Worker fresh session at"), percent),
  field("activeStart", () => t("Work hours start"), hour),
  field("activeEnd", () => t("Work hours end"), hour),
  field("quietStart", () => t("Quiet hours start"), hour),
  field("quietEnd", () => t("Quiet hours end"), hour),
  field("idleMinutes", () => t("Idle after"), minutes),
  field("awayMinutes", () => t("Away after"), minutes),
  field("stallMinutes", () => t("Stall timeout"), minutes),
  field("keepAwakeWhileWorking", () => t("Keep awake while jobs run"), yesNo),
  field("keepAwakeWhileAway", () => t("Keep awake while away"), yesNo),
  field("urgentNotificationRepeats", () => t("Urgent reminders"), count),
  field("urgentNotificationIntervalMinutes", () => t("Reminder interval"), minutes),
  field("notificationPresent", () => t("When present"), notify),
  field("notificationAway", () => t("When away"), notify),
  field("observationTaskDone", () => t("Task done"), yesNo),
  field("observationTaskNeedsInput", () => t("Needs input"), yesNo),
];

export type BuilderEntry = {
  key: BuilderFieldKey;
  label: string;
  /** "—" when the draft has no value for the field. */
  before: string;
  after: string;
  value: NonNullable<AssistantProfileProposal[BuilderFieldKey]>;
};

/**
 * One entry per proposed field whose value differs from the draft, in display order. A field the
 * model repeated unchanged offers nothing to apply and is left out.
 */
export function builderEntries(
  current: AssistantProfilePatch,
  proposal: AssistantProfileProposal,
): BuilderEntry[] {
  const entries: BuilderEntry[] = [];
  for (const def of FIELDS) {
    const next = proposal[def.key];
    if (next === undefined || next === current[def.key]) continue;
    const before = current[def.key];
    entries.push({
      key: def.key,
      label: def.label(),
      before: before === undefined ? "—" : def.format(before as never),
      after: def.format(next as never),
      value: next,
    });
  }
  return entries;
}

/** The patch for the checked entries; the edited persona replaces the proposed one when it is checked. */
export function builderPatch(
  entries: readonly BuilderEntry[],
  checked: ReadonlySet<BuilderFieldKey>,
  options: { persona?: string; avatar?: string } = {},
): AssistantProfilePatch {
  const patch: Record<string, unknown> = {};
  for (const entry of entries) if (checked.has(entry.key)) patch[entry.key] = entry.value;
  if (checked.has("persona") && options.persona !== undefined)
    patch.persona = options.persona.slice(0, 2000);
  if (options.avatar) patch.avatar = options.avatar;
  return patch as AssistantProfilePatch;
}
