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

const CHAT_STEPS = [
  {
    title: "Start a chat",
    description:
      "Open a project, start a new session and choose your agent and model. Describe the result you want and include the relevant files or attachments.",
    tips: [
      "Enter sends your message. Shift+Enter adds a new line.",
      "Use @ to attach context and / to discover available commands.",
    ],
    shortcuts: ["Tab: New", "App: Switch Model"],
    example: "Find the cause of this error, fix it and run the relevant tests.",
    targets: ["composer"] as UsageGuideTarget[],
    need: "chat" as GuideNeed,
  },
  {
    title: "Send now or queue for later",
    description:
      "Send steers the active turn. Use the queue button to send after it finishes. If steering is unavailable, the message waits in the queue.",
    tips: [
      "To explicitly queue a follow-up, write it and use the queue button or the queue shortcut while a turn is running.",
      "Queued messages run in order after the current turn. You can edit, remove or reorder them above the message box.",
    ],
    shortcuts: ["Composer: Queue Message"],
    example: "When you finish, review the changed files and summarize the risks.",
    targets: ["queue-button", "queue", "send-controls", "composer"] as UsageGuideTarget[],
    need: "chat" as GuideNeed,
  },
  {
    title: "Stop and resume deliberately",
    description:
      "Use Stop to interrupt the running turn. The stop shortcut works when the message box has focus and no suggestion menu is open.",
    tips: [
      "Interrupting pauses the queue. Review pending messages and use Resume when you are ready to continue.",
      "Stopping does not undo file changes or guarantee that every external process has ended. Review the changes before continuing.",
    ],
    shortcuts: ["Session: Stop Turn"],
    example: "Stop → review changes and queued messages → Resume",
    targets: ["stop-button", "send-controls", "composer"] as UsageGuideTarget[],
    need: "chat" as GuideNeed,
  },
  {
    title: "Review the result",
    description:
      "Read the agent's answer and inspect changed files in Changes. Check the reported tests and any remaining questions before starting the next task.",
    tips: [
      "Permission requests and questions need your response before the agent can continue.",
      "Use message actions to copy useful output. Keep separate tasks in separate sessions so their context stays clear.",
    ],
    shortcuts: ["App: Go to File", "App: Find in Files", "Terminal: Toggle Dock"],
    targets: ["changes"] as UsageGuideTarget[],
    need: "changes" as GuideNeed,
  },
  {
    title: "Keep essential shortcuts nearby",
    description:
      "These are your current shortcuts, including custom bindings. Change or disable them in Settings → Keybindings. You can reopen this guide from View or Settings → General.",
    tips: ["Queue and Stop shortcuts apply in the message box; close suggestion menus first."],
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

const CHAT_SHORTCUT_LABELS: Record<string, string> = {
  "Tab: New": "New Tab",
  "App: Switch Model": "Switch Model…",
  "Composer: Queue Message": "Queue message",
  "Session: Stop Turn": "Stop",
  "App: Go to File": "Go to File…",
  "App: Find in Files": "Find in Files…",
  "Terminal: Toggle Dock": "Toggle Terminal",
  "App: Search": "Search",
  "App: Command Palette": "Command Palette…",
  "App: Settings": "Settings",
};

function chatTour(): TourStep[] {
  return CHAT_STEPS.map((step) => ({
    title: t(step.title),
    description: t(step.description),
    tips: step.tips.map((tip) => t(tip)),
    shortcuts: step.shortcuts.map((command) => ({
      command,
      label: t(CHAT_SHORTCUT_LABELS[command]),
    })),
    example: step.example ? t(step.example) : undefined,
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
