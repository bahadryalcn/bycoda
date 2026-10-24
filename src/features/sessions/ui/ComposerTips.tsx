import { memo, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { useLocale, useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
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

// CSS adaptation of React Bits Fold Text's top hinge, perspective and crease shading.
// https://reactbits.dev/text-animations/fold-text
// Copyright (c) 2026 David Haz. License: vendor/react-bits/LICENSE.md.
function FoldTip({ text, animate }: { text: string; animate: boolean }) {
  const characters = Array.from(text);
  const [settled, setSettled] = useState(!animate);
  useEffect(() => {
    if (!animate) setSettled(true);
  }, [animate]);
  // Long, translated hints should finish unfolding as quickly as short ones.
  const stagger = Math.min(16, 400 / Math.max(1, characters.length - 1));

  return (
    <p
      className="composer-tips-text"
      aria-label={text}
      data-tip-fold-animate={animate && !settled ? "true" : undefined}
    >
      <span aria-hidden="true" data-tip-fold>
        {characters.map((character, index) => (
          <span
            key={index}
            className="composer-tip-fold-segment"
            style={{ "--tip-fold-delay": `${index * stagger}ms` } as CSSProperties}
          >
            <span
              className="composer-tip-fold-piece"
              onAnimationEnd={index === characters.length - 1 ? () => setSettled(true) : undefined}
            >
              {character === " " ? "\u00a0" : character}
            </span>
          </span>
        ))}
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
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tipId = useId();
  const keepOpen = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const closeSoon = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
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
    <aside data-composer-tips className="composer-tips" aria-label={t("Chat tips")}>
      <Button
        ref={anchor}
        variant="ghost"
        iconOnly
        motion="none"
        label={t("Next tip")}
        title=""
        aria-describedby={open || focusWithin ? tipId : undefined}
        className="composer-tips-icon"
        onMouseEnter={keepOpen}
        onMouseLeave={closeSoon}
        onFocus={() => {
          setFocusWithin(true);
          keepOpen();
        }}
        onBlur={() => {
          setFocusWithin(false);
          closeSoon();
        }}
        onClick={() => {
          keepOpen();
          setTip((current) => (current + 1) % COMPOSER_TIPS.length);
        }}
      >
        <AiIdea size={14} />
      </Button>
      {open || focusWithin ? (
        <Popover
          anchor={anchor}
          id={tipId}
          role="tooltip"
          side="top"
          align="start"
          width={320}
          restoreFocus={false}
          onDismiss={() => {
            setOpen(false);
            setFocusWithin(false);
          }}
          onMouseEnter={keepOpen}
          onMouseLeave={closeSoon}
          className="composer-tips-copy p-3"
        >
          <FoldTip
            key={`${locale}-${index}`}
            text={t(COMPOSER_TIPS[index])}
            animate={active && !hidden}
          />
        </Popover>
      ) : null}
    </aside>
  );
});
