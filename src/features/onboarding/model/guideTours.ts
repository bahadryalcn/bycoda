import { t } from "../../../shared/i18n";
import { guideTopics, type GuideNeed, type GuideShortcut } from "./guideTopics";
import type { UsageGuideTarget } from "./usageGuideTargets";

export type TourStep = {
  title: string;
  description: string;
  tips: string[];
  shortcuts: GuideShortcut[];
  example?: string;
  /** Controls to spotlight, best first. Empty: the step is explained in the center. */
  targets: readonly UsageGuideTarget[];
  /** What opens the controls when none is on screen. */
  need?: GuideNeed;
  /** The guide step this tour step covers, when it maps to one. */
  stepId?: string;
};

function chatSteps() {
  return [
    {
      title: t("Start a chat"),
      description: t(
        "Open a project, start a new session and choose your agent and model. Describe the result you want and include the relevant files or attachments.",
      ),
      tips: [
        t("Enter sends your message. Shift+Enter adds a new line."),
        t("Use @ to attach context and / to discover available commands."),
      ],
      shortcuts: ["Tab: New", "App: Switch Model"],
      example: t("Find the cause of this error, fix it and run the relevant tests."),
      targets: ["composer"] as UsageGuideTarget[],
      need: "chat" as GuideNeed,
    },
    {
      title: t("Send now or queue for later"),
      description: t(
        "Send steers the active turn. Use the queue button to send after it finishes. If steering is unavailable, the message waits in the queue.",
      ),
      tips: [
        t(
          "To explicitly queue a follow-up, write it and use the queue button or the queue shortcut while a turn is running.",
        ),
        t(
          "Queued messages run in order after the current turn. You can edit, remove or reorder them above the message box.",
        ),
      ],
      shortcuts: ["Composer: Queue Message"],
      example: t("When you finish, review the changed files and summarize the risks."),
      targets: ["queue-button", "queue", "send-controls", "composer"] as UsageGuideTarget[],
      need: "chat" as GuideNeed,
    },
    {
      title: t("Stop and resume deliberately"),
      description: t(
        "Use Stop to interrupt the running turn. The stop shortcut works when the message box has focus and no suggestion menu is open.",
      ),
      tips: [
        t(
          "Interrupting pauses the queue. Review pending messages and use Resume when you are ready to continue.",
        ),
        t(
          "Stopping does not undo file changes or guarantee that every external process has ended. Review the changes before continuing.",
        ),
      ],
      shortcuts: ["Session: Stop Turn"],
      example: t("Stop → review changes and queued messages → Resume"),
      targets: ["stop-button", "send-controls", "composer"] as UsageGuideTarget[],
      need: "chat" as GuideNeed,
    },
    {
      title: t("Review the result"),
      description: t(
        "Read the agent's answer and inspect changed files in Changes. Check the reported tests and any remaining questions before starting the next task.",
      ),
      tips: [
        t("Permission requests and questions need your response before the agent can continue."),
        t(
          "Use message actions to copy useful output. Keep separate tasks in separate sessions so their context stays clear.",
        ),
      ],
      shortcuts: ["App: Go to File", "App: Find in Files", "Terminal: Toggle Dock"],
      targets: ["changes"] as UsageGuideTarget[],
      need: "changes" as GuideNeed,
    },
    {
      title: t("Keep essential shortcuts nearby"),
      description: t(
        "These are your current shortcuts, including custom bindings. Change or disable them in Settings → Shortcuts. You can reopen this guide from View or Settings → General.",
      ),
      tips: [t("Queue and Stop shortcuts apply in the message box; close suggestion menus first.")],
      shortcuts: [
        "App: Search",
        "App: Command Palette",
        "App: Settings",
        "Tab: New",
        "Composer: Queue Message",
        "Session: Stop Turn",
      ],
      targets: ["project-navigation"] as UsageGuideTarget[],
      need: "rail" as GuideNeed,
    },
  ];
}

function chatShortcutLabels(): Record<string, string> {
  return {
    "Tab: New": t("New tab"),
    "App: Switch Model": t("Switch Model…"),
    "Composer: Queue Message": t("Queue message"),
    "Session: Stop Turn": t("Stop"),
    "App: Go to File": t("Go to File…"),
    "App: Find in Files": t("Find in Files…"),
    "Terminal: Toggle Dock": t("Toggle Terminal"),
    "App: Search": t("Search"),
    "App: Command Palette": t("Command Palette…"),
    "App: Settings": t("Settings"),
  };
}

function chatTour(): TourStep[] {
  const labels = chatShortcutLabels();
  return chatSteps().map((step) => ({
    title: step.title,
    description: step.description,
    tips: step.tips,
    shortcuts: step.shortcuts.map((command) => ({ command, label: labels[command] })),
    example: step.example,
    targets: step.targets,
    need: step.need,
  }));
}

/** Topic ids that have a quick tour. */
export function tourTopicIds(): string[] {
  return guideTopics()
    .filter((topic) => topic.tour)
    .map((topic) => topic.id);
}

/**
 * The steps of a quick tour, or of the single-step spotlight when `stepId` is given.
 * Chat keeps its dedicated five-step walkthrough; other topics tour their own steps.
 */
export function tourPlan(
  topicId: string,
  stepId?: string,
): { topicId: string; steps: TourStep[] } | null {
  const topic = guideTopics().find((entry) => entry.id === topicId);
  if (!topic) return null;
  if (!stepId) {
    return {
      topicId,
      steps:
        topicId === "chat"
          ? chatTour()
          : topic.steps.map((step) => ({
              title: step.title,
              description: step.text,
              tips: [],
              shortcuts: step.shortcuts ?? [],
              targets: step.show?.targets ?? [],
              need: step.show?.need,
              stepId: step.id,
            })),
    };
  }
  const step = topic.steps.find((entry) => entry.id === stepId);
  if (!step) return null;
  return {
    topicId,
    steps: [
      {
        title: step.title,
        description: step.text,
        tips: [],
        shortcuts: step.shortcuts ?? [],
        targets: step.show?.targets ?? [],
        need: step.show?.need,
        stepId: step.id,
      },
    ],
  };
}
