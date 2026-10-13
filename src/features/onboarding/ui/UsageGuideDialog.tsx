import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ACTIONS, EVENTS, Joyride, STATUS, type EventData, type Step } from "react-joyride";
import { t, useLocale } from "../../../shared/i18n";
import { LAYER } from "../../../shared/lib/layers";
import { useOverlay } from "../../../shared/ui/overlay";
import { findUsageGuideTarget, type UsageGuideTarget } from "../model/usageGuideTargets";
import {
  KEYBINDINGS,
  keybindingShortcutLabel,
  subscribeKeybindings,
} from "../../settings/model/settings";
import "./usageGuide.css";

const steps = [
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
  },
  {
    title: "Send now or queue for later",
    description:
      "While the agent is working, sending a message follows your Chat settings: steer the current turn or queue the message. Agent capabilities can affect this behavior.",
    tips: [
      "To explicitly queue a follow-up, write it and use the queue button or the queue shortcut while a turn is running.",
      "Queued messages run in order after the current turn. You can edit, remove or reorder them above the message box.",
    ],
    shortcuts: ["Composer: Queue Message"],
    example: "When you finish, review the changed files and summarize the risks.",
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
  },
  {
    title: "Keep essential shortcuts nearby",
    description:
      "These are your current shortcuts, including custom bindings. Change or disable them in Settings → Shortcuts. You can reopen this guide from View or Settings → Workspace.",
    tips: ["Queue and Stop shortcuts apply in the message box; close suggestion menus first."],
    shortcuts: [
      "App: Search",
      "App: Command Palette",
      "App: Settings",
      "Tab: New",
      "Composer: Queue Message",
      "Session: Stop Turn",
    ],
  },
];

const shortcutLabels: Record<string, string> = {
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

const targets: readonly (readonly UsageGuideTarget[])[] = [
  ["composer"],
  ["queue-button", "queue", "send-controls", "composer"],
  ["stop-button", "send-controls", "composer"],
  ["changes"],
  ["project-navigation"],
];

export default function UsageGuideDialog({ onClose }: { onClose: () => void }) {
  useLocale();
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [, refreshBindings] = useState(0);
  const closed = useRef(false);
  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    onClose();
  }, [onClose]);
  const overlayRoot = useRef<HTMLElement | null>(document.body);
  useOverlay(overlayRoot, false, close);
  useEffect(() => subscribeKeybindings(() => refreshBindings((value) => value + 1)), []);
  // Workspace controls can mount in the same commit as the guide. Resolve the
  // first spotlight only after those DOM nodes exist, before the browser paints.
  useLayoutEffect(() => setReady(true), []);
  if (!ready) return <div data-usage-guide-running="true" />;
  const tourSteps: Step[] = steps.map((current, index) => {
    const target = findUsageGuideTarget(targets[index]);
    return {
      target: target ?? document.body,
      placement: target ? "auto" : "center",
      title: t(current.title),
      content: (
        <section
          className="usage-guide-content"
          data-usage-guide-tooltip
          aria-label={t("Usage guide")}
        >
          <p className="usage-guide-progress" aria-live="polite">
            {t("Step {p0} of {p1}", { p0: index + 1, p1: steps.length })}
          </p>
          <p>{t(current.description)}</p>
          {current.example ? <blockquote>{t(current.example)}</blockquote> : null}
          <ul>
            {current.tips.map((tip) => (
              <li key={tip}>{t(tip)}</li>
            ))}
          </ul>
          <dl className="usage-guide-shortcuts">
            {current.shortcuts.map((command) => {
              const fallback =
                KEYBINDINGS.find((binding) => binding.command === command)?.keys ?? "";
              const keys = keybindingShortcutLabel(command, fallback);
              return (
                <div key={command}>
                  <dt>{t(shortcutLabels[command])}</dt>
                  <dd>{keys ? <kbd>{keys}</kbd> : t("Disabled")}</dd>
                </div>
              );
            })}
          </dl>
        </section>
      ),
    };
  });
  const onEvent = (event: EventData) => {
    if (
      event.status === STATUS.FINISHED ||
      event.status === STATUS.SKIPPED ||
      event.action === ACTIONS.CLOSE
    ) {
      close();
    } else if (event.type === EVENTS.TARGET_NOT_FOUND) {
      // Re-resolve a disappearing live control using the safe composer/body fallback.
      refreshBindings((value) => value + 1);
    } else if (event.type === EVENTS.STEP_AFTER) {
      // Controlled tours must end explicitly rather than pinning the index to
      // the last step, which leaves Joyride's backdrop mounted after Done.
      if (event.index === steps.length - 1 && event.action === ACTIONS.NEXT) {
        close();
        return;
      }
      setStep(
        Math.max(
          0,
          Math.min(steps.length - 1, event.index + (event.action === ACTIONS.PREV ? -1 : 1)),
        ),
      );
    }
  };

  return (
    <div data-usage-guide-running="true">
      <Joyride
        run
        continuous
        stepIndex={step}
        steps={tourSteps}
        onEvent={onEvent}
        options={{
          skipBeacon: true,
          skipScroll: true,
          scrollDuration: 0,
          buttons: ["back", "close", "primary", "skip"],
          blockTargetInteraction: true,
          overlayClickAction: false,
          dismissKeyAction: false,
          closeButtonAction: "skip",
          backgroundColor: "var(--color-background-base)",
          textColor: "var(--color-content)",
          primaryColor: "var(--color-content)",
          width: 440,
          targetWaitTimeout: 0,
          zIndex: LAYER.dialog,
        }}
        locale={{
          back: t("← Back"),
          close: t("Close guide"),
          skip: t("Close guide"),
          last: t("Done"),
          next: t("Continue →"),
          open: t("Usage guide"),
        }}
        styles={{
          tooltip: {
            borderRadius: 14,
            maxWidth: "calc(100vw - 24px)",
            maxHeight: "calc(100dvh - 32px)",
            overflowY: "auto",
          },
          tooltipTitle: { fontSize: 20 },
          buttonPrimary: { borderRadius: 8 },
        }}
      />
    </div>
  );
}
