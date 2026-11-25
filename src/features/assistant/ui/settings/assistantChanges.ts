import { t } from "../../../../shared/i18n";
import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";
import type { PendingChange } from "../../../../shared/ui/settings";

type Key = keyof AssistantProfilePatch;

/** The change group of each profile field; fields that share one control share one group, named by its English label. */
const LABEL: Partial<Record<Key, string>> = {
  name: "Assistant name",
  avatar: "Avatar",
  showTitle: "Show title",
  addressAs: "How should I address you?",
  addressFrequency: "How often to use your name",
  tone: "Tone",
  allowProfanity: "Allow profanity",
  persona: "Persona",
  language: "Language",
  voiceNarration: "Speak job updates while voice is connected",
  proactiveSpeech: "Start a conversation",
  autonomy: "Autonomy",
  planApproval: "Plan approval",
  confirmJobs: "Confirm jobs before starting",
  allowRoutineQuestions: "Answer routine worker questions",
  execution: "Job execution",
  dailyTokenBudget: "Daily token budget",
  notificationPresent: "When present",
  notificationAway: "When away",
  observationTaskDone: "Task done",
  observationTaskNeedsInput: "Needs input",
  notificationTelegram: "Telegram",
  keepAwakeWhileWorking: "Keep awake while jobs run",
  keepAwakeWhileAway: "Keep awake while away",
  idleMinutes: "Idle after",
  awayMinutes: "Away after",
  stallMinutes: "Stall timeout",
  activeStart: "Active hours",
  activeEnd: "Active hours",
  quietStart: "Quiet hours",
  quietEnd: "Quiet hours",
  perWakeTokenCap: "Cost and context",
  chiefSoftContext: "Cost and context",
  chiefHardContext: "Cost and context",
  workerSoftContext: "Cost and context",
  workerHardContext: "Cost and context",
  workerCompactPercent: "Cost and context",
  workerHandoffPercent: "Cost and context",
  chiefWakeLimit: "Cost and context",
  nudgeLimit: "Cost and context",
  summaryRefreshMessages: "Cost and context",
  permissionLevel: "Access",
  permissionProjectIds: "Access",
  criticalExclusions: "Access",
};

/** The translated group title for a change group id (the English field label). */
function groupLabel(group: string): string {
  switch (group) {
    case "Assistant name":
      return t("Assistant name");
    case "Avatar":
      return t("Avatar");
    case "Show title":
      return t("Show title");
    case "How should I address you?":
      return t("How should I address you?");
    case "How often to use your name":
      return t("How often to use your name");
    case "Tone":
      return t("Tone");
    case "Allow profanity":
      return t("Allow profanity");
    case "Persona":
      return t("Persona");
    case "Language":
      return t("Language");
    case "Speak job updates while voice is connected":
      return t("Speak job updates while voice is connected");
    case "Start a conversation":
      return t("Start a conversation");
    case "Autonomy":
      return t("Autonomy");
    case "Plan approval":
      return t("Plan approval");
    case "Confirm jobs before starting":
      return t("Confirm jobs before starting");
    case "Answer routine worker questions":
      return t("Answer routine worker questions");
    case "Job execution":
      return t("Job execution");
    case "Daily token budget":
      return t("Daily token budget");
    case "When present":
      return t("When present");
    case "When away":
      return t("When away");
    case "Task done":
      return t("Task done");
    case "Needs input":
      return t("Needs input");
    case "Telegram":
      return t("Telegram");
    case "Keep awake while jobs run":
      return t("Keep awake while jobs run");
    case "Keep awake while away":
      return t("Keep awake while away");
    case "Idle after":
      return t("Idle after");
    case "Away after":
      return t("Away after");
    case "Stall timeout":
      return t("Stall timeout");
    case "Active hours":
      return t("Active hours");
    case "Quiet hours":
      return t("Quiet hours");
    case "Cost and context":
      return t("Cost and context");
    case "Access":
      return t("Access");
    case "Other changes":
      return t("Other changes");
    default:
      return group;
  }
}

function detail(value: unknown): string | undefined {
  if (typeof value === "boolean") return value ? t("On") : t("Off");
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.length > 0 && value.length <= 40 ? value : undefined;
}

export type AssistantChangeInput = {
  draft: AssistantProfilePatch;
  saved: AssistantProfilePatch;
  retention: number;
  savedRetention: number;
  /** Standing consent is renewed on Save even when no field changed. */
  consentDirty: boolean;
  /** Embedded sections that hold their own drafts and cannot revert one field. */
  sections: { projects: boolean; computer: boolean; folders: boolean };
  setDraft: (update: (current: AssistantProfilePatch) => AssistantProfilePatch) => void;
  setRetention: (days: number) => void;
};

/** Every unsaved edit across the profile, retention and the embedded access sections. */
export function assistantChanges(input: AssistantChangeInput): PendingChange[] {
  const { draft, saved, setDraft } = input;
  const groups = new Map<string, Key[]>();
  for (const key of new Set([...Object.keys(draft), ...Object.keys(saved)]) as Set<Key>) {
    if (JSON.stringify(draft[key]) === JSON.stringify(saved[key])) continue;
    const label = LABEL[key] ?? "Other changes";
    groups.set(label, [...(groups.get(label) ?? []), key]);
  }
  const changes: PendingChange[] = [...groups].map(([label, keys]) => ({
    id: `profile:${label}`,
    label: groupLabel(label),
    detail: keys.length === 1 ? detail(draft[keys[0]!]) : undefined,
    // Access edits renew a native consent that only Discard clears.
    revert:
      label === "Access"
        ? undefined
        : () =>
            setDraft((current) => ({
              ...current,
              ...Object.fromEntries(keys.map((key) => [key, saved[key]])),
            })),
  }));
  if (input.consentDirty && !groups.has("Access"))
    changes.push({ id: "consent", label: t("Access") });
  if (input.retention !== input.savedRetention)
    changes.push({
      id: "retention",
      label: t("Retention and usage"),
      revert: () => input.setRetention(input.savedRetention),
    });
  if (input.sections.projects)
    changes.push({ id: "projects", label: t("Manual session supervision") });
  if (input.sections.computer) changes.push({ id: "computer", label: t("Computer use") });
  if (input.sections.folders) changes.push({ id: "folders", label: t("Folders and commands") });
  return changes;
}
