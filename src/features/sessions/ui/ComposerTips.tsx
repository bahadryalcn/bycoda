import { memo, useEffect, useId, useRef, useState } from "react";
import { useLocale, useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { Text } from "../../../shared/ui/Text";
import { AiIdea } from "../../../shared/ui/icons";
import "./ComposerTips.css";

export const COMPOSER_TIPS = [
  "Type @ in the message box to find and attach a project file for the agent to read.",
  "Type / in the message box to see the commands available for your selected agent.",
  "Attach a screenshot to show the agent exactly where a visual problem appears.",
  "Use the selectors beside the message box to choose the agent and model for your next message.",
  "Open Files to browse your project and read or edit a file without leaving the chat.",
  "Use Find in Files to locate a function, error message or setting across the project.",
  "Open a file in Changes to compare the original code with the agent's edits.",
  "In Changes, stage only the files you want to include in your next commit.",
  "Open the terminal dock to run project commands while keeping the conversation visible.",
  "Use Split in the terminal dock to keep two terminals visible side by side.",
  "Use the pane layout controls to keep a conversation and a file visible together.",
  "Pin a session in the session list to keep a frequently used conversation easy to find.",
  "Use Notes to save decisions, checklists and project information for later.",
  "While the agent works, use Queue message to save the next request for after the current turn.",
  "Above the message box, edit a queued message or drag it to change the sending order.",
  "Stop pauses the message queue too. Review pending messages and use Resume when ready.",
  "Stopping the agent leaves existing file edits in place; review them in Changes before continuing.",
  "Send steers the active turn. Use the queue button to send after it finishes. If steering is unavailable, the message waits in the queue.",
  "Use Connections to set up another machine, then select its project to work remotely.",
  "When creating a task, check its machine, branch and worktree to choose where the work runs.",
  "Use Goals to plan a larger job as tasks; review the proposed plan before approving it.",
  "In Social Media, review drafts before publishing; saving a draft does not authorize sending it.",
  "Customize your shortcuts in Settings → Shortcuts and see the current keys in the usage guide.",
  "Open View → Usage guide for a walkthrough of sending, queuing and reviewing agent work.",
] as const;

export const COMPOSER_TIP_INTERVAL = 20_000;

/** One quiet reveal for the whole hint; the text is complete from the first frame. */
function TipText({ text, animate }: { text: string; animate: boolean }) {
  const [settled, setSettled] = useState(!animate);
  if (!animate && !settled) setSettled(true);

  return (
    <p
      className="composer-tips-text"
      aria-label={text}
      data-tip-fold-animate={animate && !settled ? "true" : undefined}
    >
      <span
        aria-hidden="true"
        data-tip-fold
        className="composer-tip-reveal"
        onAnimationEnd={() => setSettled(true)}
      >
        {text}
      </span>
    </p>
  );
}

export const ComposerTips = memo(function ComposerTips({ active }: { active: boolean }) {
  const t = useT();
  const locale = useLocale();
  const [index, setTip] = useState(() => Math.floor(Math.random() * COMPOSER_TIPS.length));
  const [open, setOpen] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const tipId = useId();
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (!active || !open || focusWithin || hidden) return;
    const timer = window.setInterval(
      () => setTip((index) => (index + 1) % COMPOSER_TIPS.length),
      COMPOSER_TIP_INTERVAL,
    );
    return () => window.clearInterval(timer);
  }, [active, open, focusWithin, hidden]);

  return (
    <Text
      as="aside"
      tone="muted"
      leading="normal"
      data-composer-tips
      className="composer-tips"
      aria-label={t("Chat tips")}
    >
      <Button
        ref={anchor}
        variant="ghost"
        size="sm"
        iconOnly
        motion="none"
        label={t(open ? "Next tip" : "Tip")}
        title=""
        aria-controls={open ? tipId : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="composer-tips-icon"
        textTone="muted"
        onFocus={() => setFocusWithin(true)}
        onBlur={() => setFocusWithin(false)}
        onClick={() => {
          if (open) setTip((current) => (current + 1) % COMPOSER_TIPS.length);
          else setOpen(true);
        }}
      >
        <AiIdea className="icon-sm" />
        <span className="sr-only">{t(open ? "Next tip" : "Tip")}</span>
      </Button>
      {open ? (
        <Popover
          anchor={anchor}
          id={tipId}
          kind="dialog"
          aria-label={t("Chat tips")}
          autoFocus={false}
          side="top"
          align="start"
          width={320}
          restoreFocus={false}
          onDismiss={() => setOpen(false)}
          className="p-3"
        >
          <Text as="div" tone="secondary" leading="relaxed" className="composer-tips-copy">
            <TipText
              key={`${locale}-${index}`}
              text={t(COMPOSER_TIPS[index])}
              animate={active && !hidden}
            />
          </Text>
        </Popover>
      ) : null}
    </Text>
  );
});
