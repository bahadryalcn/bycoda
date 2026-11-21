// Official free Arc registry source, adapted to bycoda shared semantics: the notice anatomy,
// glyphs, tone ink and actions come from ../../Notice; only presence (height collapse) stays here.
"use client";

import { useRef, useState } from "react";
import type { HTMLAttributes, ReactNode, Ref } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type TargetAndTransition,
  type Transition,
} from "motion/react";
import { X } from "../../icons";
import { Button } from "../../Button";
import {
  NoticeButton,
  NoticeGlyph,
  NoticeSlot,
  noticeEnterClass,
  type NoticeAction,
} from "../../Notice";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./alert.module.css";

export type AlertTone = "info" | "success" | "warning" | "danger";
export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>;
  tone?: AlertTone;
  title?: string;
  icon?: ReactNode;
  children?: ReactNode;
  /** Controls presence. Hiding the alert collapses its height and fades it out. */
  open?: boolean;
  /** Shows a dismiss button. An uncontrolled alert collapses first, then calls this. */
  onDismiss?: () => void;
  /** The one follow-up (Retry, Open settings), rendered as a secondary small button after the copy. */
  action?: NoticeAction;
  /** A second follow-up, rendered after `action`. */
  secondaryAction?: NoticeAction;
  /** Escape for one non-button control after the actions (an ErrorDetails trigger, a menu). */
  extra?: ReactNode;
  /** Vertically center the actions and dismiss control beside multiline copy. */
  actionsAlign?: "center";
  /** Accessible name of the dismiss control. Defaults to `Dismiss` plus the title. */
  dismissLabel?: string;
}
type AlertBoxProps = Omit<AlertProps, "open">;

function AlertBox({
  tone = "info",
  title,
  children,
  className,
  onDismiss,
  icon,
  role,
  action,
  secondaryAction,
  extra,
  actionsAlign,
  dismissLabel,
  ...props
}: AlertBoxProps) {
  const hasDetails =
    children !== undefined && children !== null && children !== false && children !== "";
  const hasActions = Boolean(action || secondaryAction || extra);
  return (
    <div
      {...props}
      className={[
        styles.alert,
        styles[tone],
        actionsAlign && styles.centerActions,
        noticeEnterClass,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role={role ?? (tone === "danger" ? "alert" : "status")}
    >
      <NoticeGlyph tone={tone} size="box" icon={icon} />
      {/* Copy and actions share one row; actions wrap below only when the row is too narrow. */}
      <div className={styles.body}>
        <div className={styles.copy}>
          {title ? <strong className={styles.title}>{title}</strong> : null}
          {hasDetails ? <div className={styles.description}>{children}</div> : null}
        </div>
        {hasActions ? (
          <div className={styles.actions}>
            {action ? <NoticeButton action={action} /> : null}
            {secondaryAction ? <NoticeButton action={secondaryAction} /> : null}
            {extra}
          </div>
        ) : null}
      </div>
      {onDismiss ? (
        <NoticeSlot size="box" className={actionsAlign ? styles.centerDismiss : undefined}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            label={dismissLabel ?? (title ? `Dismiss: ${title}` : "Dismiss")}
            onClick={onDismiss}
          >
            <X className="icon-md" aria-hidden="true" />
          </Button>
        </NoticeSlot>
      ) : null}
    </div>
  );
}

const collapsed: TargetAndTransition = { height: 0, opacity: 0 };

export function Alert({ open, onDismiss, ...props }: AlertProps) {
  const reduce = useReducedMotion();
  const [dismissed, setDismissed] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const setClip = (value: string) => {
    if (shell.current) shell.current.style.overflow = value;
  };
  if (open === undefined && !onDismiss) return <AlertBox {...props} />;
  const isOpen = open ?? !dismissed;
  const dismiss = onDismiss && (() => (open === undefined ? setDismissed(true) : onDismiss()));
  // One motion: height and opacity share the standard duration; reduced motion is a plain fade.
  const presence: Transition = {
    duration: motionTokens.duration.standard,
    ease: [...motionTokens.ease.standard],
  };
  const fadeOnly: Transition = {
    duration: reduce ? motionTokens.duration.instant : presence.duration,
  };
  // Presence collapses the height with the fade, so the content below closes the gap instead of jumping.
  return (
    <AnimatePresence
      initial={false}
      onExitComplete={() => {
        if (open === undefined) onDismiss?.();
      }}
    >
      {isOpen && (
        <motion.div
          key="alert"
          className={styles.presence}
          initial={reduce ? { opacity: 0 } : collapsed}
          animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
          exit={reduce ? { opacity: 0 } : collapsed}
          transition={reduce ? fadeOnly : presence}
          ref={shell}
          onAnimationStart={() => setClip("hidden")}
          onAnimationComplete={() => setClip("")}
        >
          <AlertBox {...props} onDismiss={dismiss} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default Alert;
