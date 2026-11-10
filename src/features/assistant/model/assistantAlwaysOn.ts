import { t } from "../../../shared/i18n";
import type { AssistantAlwaysOn } from "../../../shared/model/assistantAlwaysOn";
import type { AssistantModelPoolRow } from "../../../shared/model/assistantModelPool";
import type {
  AssistantKeepAwakeStatus,
  AssistantProfile,
} from "../../../shared/model/host-contracts/assistant";

/** Where the owner changes the item: a Room settings page, or the setup wizard. */
export type AlwaysOnTarget = "setup" | "work" | "schedule";
export type AlwaysOnState = "done" | "todo" | "unknown" | "unsupported" | "review";
export type AlwaysOnItem = {
  id:
    | "enabled"
    | "autonomy"
    | "model"
    | "budget"
    | "keepAwake"
    | "phonePush"
    | "observation"
    | "awayNotices"
    | "quietHours"
    | "logout";
  state: AlwaysOnState;
  label: string;
  detail: string;
  target?: AlwaysOnTarget;
};

export type AlwaysOnInput = {
  profile: Pick<
    AssistantProfile,
    | "enabled"
    | "setupComplete"
    | "autonomy"
    | "execution"
    | "dailyTokenBudget"
    | "keepAwakeWhileWorking"
    | "observationTaskDone"
    | "observationTaskNeedsInput"
    | "notificationAway"
    | "quietStart"
    | "quietEnd"
  >;
  keepAwake?: Pick<AssistantKeepAwakeStatus, "supported">;
  /** Saved pool rows, or null while unread or when the read failed. */
  poolRows: readonly Pick<AssistantModelPoolRow, "roles">[] | null;
  /** Null while unread or when the read failed. */
  alwaysOn: AssistantAlwaysOn | null;
};

const ADVICE_WHEN_TODO = new Set(["autonomy", "budget", "keepAwake", "observation", "awayNotices"]);
const hour = (value: number) => `${String(value).padStart(2, "0")}:00`;

/** Derives the checklist from saved state only. It never reads drafts and never writes. */
export function deriveAlwaysOnItems(input: AlwaysOnInput): AlwaysOnItem[] {
  const { profile, keepAwake, poolRows, alwaysOn } = input;
  const items: AlwaysOnItem[] = [];
  const add = (item: AlwaysOnItem) => items.push(item);

  add({
    id: "enabled",
    label: t("Assistant is turned on"),
    state: profile.enabled && profile.setupComplete ? "done" : "todo",
    detail: t("Setup is finished and the assistant is enabled."),
    target: "setup",
  });
  add({
    id: "autonomy",
    label: t("Jobs may start on their own"),
    state: profile.autonomy === "report" ? "todo" : "done",
    detail: t("Report only never starts jobs. Choose Run jobs or Supervise assigned jobs."),
    target: "work",
  });
  const hasModel = poolRows
    ? poolRows.some((row) => row.roles.includes("worker"))
    : profile.execution
      ? true
      : null;
  add({
    id: "model",
    label: t("A worker model is chosen"),
    state: hasModel === null ? "unknown" : hasModel ? "done" : "todo",
    detail: t("Jobs run on the first worker model in the list."),
    target: "work",
  });
  add({
    id: "budget",
    label: t("Daily token budget is set"),
    state: profile.dailyTokenBudget > 0 ? "done" : "todo",
    detail: t("With no budget the assistant cannot run jobs."),
    target: "work",
  });
  add({
    id: "keepAwake",
    label: t("Keep this computer awake while working"),
    state:
      keepAwake?.supported === false
        ? "unsupported"
        : profile.keepAwakeWhileWorking
          ? "done"
          : "todo",
    detail:
      keepAwake?.supported === false
        ? t("Not supported on this computer.")
        : t("A sleeping computer stops jobs, the morning briefing and supervisor reviews."),
    target: keepAwake?.supported === false ? undefined : "schedule",
  });
  const phone: { state: AlwaysOnState; detail: string } = !alwaysOn
    ? { state: "unknown", detail: t("Phone notification status could not be read.") }
    : alwaysOn.assistantPushPhones > 0
      ? { state: "done", detail: t("A paired phone receives assistant updates.") }
      : alwaysOn.pushPhones > 0
        ? { state: "todo", detail: t("Turn on assistant updates in the phone app.") }
        : {
            state: "todo",
            detail: t("Pair a phone and allow notifications to hear about stalled jobs."),
          };
  add({ id: "phonePush", label: t("Stalled jobs reach your phone"), ...phone });
  const watched = [profile.observationTaskDone, profile.observationTaskNeedsInput];
  add({
    id: "observation",
    label: t("Task done and needs-input events are watched"),
    state: watched.every(Boolean) ? "done" : "todo",
    detail: watched.some(Boolean)
      ? t("One of the two events is still off.")
      : t("Both events are off, so finished tasks and questions go unnoticed."),
    target: "schedule",
  });
  add({
    id: "awayNotices",
    label: t("Notices reach you while you are away"),
    state: profile.notificationAway === "none" ? "todo" : "done",
    detail: t("Choose All or Urgent only for the away state."),
    target: "schedule",
  });
  add({
    id: "quietHours",
    label: t("Quiet hours reviewed"),
    state: "review",
    detail:
      profile.quietStart === profile.quietEnd
        ? t("No quiet hours.")
        : t("Quiet from {p0} to {p1}.", {
            p0: hour(profile.quietStart),
            p1: hour(profile.quietEnd),
          }),
    target: "schedule",
  });
  add({
    id: "logout",
    label: t("The Host keeps running after you sign out"),
    state: "unknown",
    detail: t(
      "Cannot be detected. On Windows the Host stops when you sign out. Stay signed in (locking is fine) and install the Host service so it restarts at sign-in.",
    ),
  });
  // These details are advice for fixing the item; a ready item shows no advice.
  return items.map((item) =>
    ADVICE_WHEN_TODO.has(item.id) && item.state === "done" ? { ...item, detail: "" } : item,
  );
}
