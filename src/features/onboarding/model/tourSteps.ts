import { t } from "../../../shared/i18n";
import type { GuideAction } from "./guide";
import type { UsageGuideTarget } from "./usageGuideTargets";

/** The real action a step's "Try it" performs before the tour moves on. */
export type TourTryIt = { label: string; action: GuideAction | "usage-guide" };

/**
 * One card of a guided tour. The first-run tour and the "What's new" highlights share this
 * shape, so both run through the same spotlight, focus and keyboard behavior.
 */
export type TourStepDef = {
  id: string;
  title: string;
  /** One short sentence. */
  body: string;
  /** Controls to spotlight, best first. Empty: the card is centered. */
  targets: readonly UsageGuideTarget[];
  /**
   * A safe existing action that brings the controls on screen when none is visible
   * (it only navigates: no data is created or changed). A step whose controls stay
   * missing is skipped; the tour continues with the rest.
   */
  reveal?: GuideAction;
  /** Optional: do the real thing, then continue. */
  tryIt?: TourTryIt;
};

/**
 * The first-run tour, in the order a new user needs it. Built at render with literal `t()`
 * calls so the locale checker sees every message.
 */
export function firstRunTourSteps(): TourStepDef[] {
  return [
    {
      id: "projects",
      title: t("Your projects"),
      body: t(
        "Open a folder with + in the project rail. Each project keeps its own sessions and changes.",
      ),
      targets: ["project-add", "project-navigation"],
      tryIt: { label: t("Open a folder"), action: "open-project" },
    },
    {
      id: "new-session",
      title: t("Start a session"),
      body: t("A session is a conversation with one agent in the current project."),
      targets: ["new-session"],
      tryIt: { label: t("New session"), action: "new-session" },
    },
    {
      id: "composer",
      title: t("Write the request"),
      body: t(
        "Describe the result you want. Type @ to attach files and / to run commands or skills.",
      ),
      targets: ["composer"],
    },
    {
      id: "model",
      title: t("Model and reasoning"),
      body: t("Choose the agent, model and how much reasoning it uses under the message box."),
      targets: ["model-controls"],
    },
    {
      id: "access",
      title: t("Choose access mode"),
      body: t("Pick what the agent may do without asking. A change applies from the next turn."),
      targets: ["access-mode"],
    },
    {
      id: "sidebar",
      title: t("Sessions, Explorer and Changes"),
      body: t("Switch the sidebar between your sessions, the project files and the changes."),
      targets: ["sidebar-tabs", "files-tab", "changes"],
      reveal: "files",
      tryIt: { label: t("Open Explorer"), action: "files" },
    },
    {
      id: "changes",
      title: t("Review before you commit"),
      body: t("Changes lists what the agents edited. Read each diff, then commit."),
      targets: ["changes"],
      reveal: "changes",
      tryIt: { label: t("Open Changes"), action: "changes" },
    },
    {
      id: "terminal",
      title: t("Terminal"),
      body: t("A terminal opens in the project folder, right beside your chats."),
      targets: ["terminal-toggle"],
      tryIt: { label: t("Open the terminal"), action: "terminal" },
    },
    {
      id: "tools",
      title: t("Background work"),
      body: t("Tasks, Automations, Inbox and Notes keep work going while you do something else."),
      targets: ["rail-tools", "rail-tasks", "rail-inbox"],
    },
    {
      id: "settings",
      title: t("Settings and the Guide"),
      body: t(
        "Settings holds every option. The Guide in the View menu repeats this tour and explains each feature.",
      ),
      targets: ["rail-settings"],
      tryIt: { label: t("Open the Guide"), action: "usage-guide" },
    },
  ];
}
