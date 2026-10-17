// Official free Arc stepper choreography, adapted to bycoda controls and workflow ownership.
"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import { Button } from "../../Button";
import { t, useLocale } from "../../../i18n";
import { isImeComposition } from "../../../lib/keyboard";
import styles from "./stepper.module.css";

export type StepperOrientation = "horizontal" | "vertical";
export type StepperStatus = "complete" | "current" | "upcoming" | "error";

export interface StepperStep {
  /** Stable key, so each step keeps its own motion when the list changes. */
  id: string;
  label: string;
  /** A short hint under the label. */
  description?: string;
  /** Marks the step as failed: the marker morphs into an alert and this message replaces the description. */
  error?: string;
  disabled?: boolean;
}

/**
 * A steps indicator for onboarding, checkout, and setup flows. Place it above (horizontal) or beside (vertical) the step
 * content and drive it with `current`; set `current` to `steps.length` once every step is done. Pass `onStepSelect` to let
 * people return to completed steps by click or keyboard. For a multi-step form that owns its own content, use MultiStepForm.
 */
export interface StepperProps {
  /** Independent completion IDs; omitted preserves linear completion. */
  completed?: readonly string[];
  /** Reachable steps; completed is the default. No content mounting is owned here. */
  selectable?: "completed" | "all" | readonly string[];
  disabled?: boolean;
  steps: StepperStep[];
  /** Index of the step in progress. `steps.length` marks the whole flow complete. */
  current: number;
  orientation?: StepperOrientation;
  /** Called with the index of a completed step when it is chosen. Without it the stepper is a read-only indicator. */
  onStepSelect?: (index: number) => void;
  /** `current` shows only the active step's description, for tight spaces. Errors always show. */
  details?: "all" | "current";
  /** Markers only; labels stay available to assistive tech. Horizontal steppers switch to this below 30rem on their own
   *  and show the current step's label underneath. */
  compact?: boolean;
  /** Accessible name for the stepper. */
  label?: string;
  /** Announced, and shown in the compact caption, once every step is complete. */
  completeLabel?: string;
  className?: string;
}

type GlyphKind = "number" | "check" | "error";

const blur = (radius: number) => `blur(${radius}px)`;
const still = { duration: 0 } as const;
const leave = {
  duration: motionTokens.duration.fast,
  ease: [...motionTokens.ease.standard],
} as const;
const settle = {
  duration: motionTokens.duration.standard,
  ease: [...motionTokens.ease.enter],
} as const;
const textFrom = { opacity: 0, y: "0.3em", filter: blur(motionTokens.blur.soft) };
const textRest = { opacity: 1, y: 0, filter: blur(0) };
const textGone = { opacity: 0, y: "-0.3em", filter: blur(motionTokens.blur.subtle) };
const glyphFrom = { opacity: 0, scale: 0.5, filter: blur(motionTokens.blur.subtle) };
const glyphRest = { opacity: 1, scale: 1, filter: blur(0) };

/** Text that rises in with a small blur when it changes. Its slot springs to the new height, so a message that wraps
 *  eases the steps below it down instead of pushing them; unrelated resizes (fonts, container width) follow exactly. */
function SwapText({
  text,
  className,
  reduced,
}: {
  text?: string;
  className?: string;
  reduced: boolean;
}) {
  const inner = useRef<HTMLSpanElement>(null);
  const armedUntil = useRef(0);
  const height = useMotionValue<number | "auto">("auto");
  useLayoutEffect(() => {
    armedUntil.current = performance.now() + 700;
  }, [text]);
  useEffect(() => {
    const node = inner.current,
      slot = node?.parentElement;
    if (!node || !slot || typeof ResizeObserver === "undefined") return;
    let measured = false;
    const observer = new ResizeObserver(() => {
      const next = node.offsetHeight;
      if (!measured || reduced || performance.now() > armedUntil.current) {
        measured = true;
        height.jump(next);
        return;
      }
      animate(height, next, motionTokens.spring.smooth);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [height, reduced]);
  return (
    <motion.span className={styles.slot} style={{ height }}>
      <span ref={inner} className={styles.slotInner}>
        <AnimatePresence mode="popLayout" initial={false}>
          {text ? (
            <motion.span
              key={`${className}:${text}`}
              className={className}
              initial={textFrom}
              animate={textRest}
              exit={{ ...textGone, transition: reduced ? still : leave }}
              transition={reduced ? still : settle}
            >
              {text}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </span>
    </motion.span>
  );
}

/** The number, check, and alert share one spot: the outgoing glyph shrinks away while the next one pops in and draws its stroke. */
function Glyph({
  kind,
  number,
  delay,
  reduced,
}: {
  kind: GlyphKind;
  number: number;
  delay: number;
  reduced: boolean;
}) {
  const pop = reduced
    ? still
    : {
        scale: { ...motionTokens.spring.snappy, delay },
        opacity: { duration: motionTokens.duration.fast, delay },
        filter: { duration: motionTokens.duration.fast, delay },
      };
  const exit = { ...glyphFrom, transition: reduced ? still : leave };
  const draw = reduced
    ? still
    : {
        duration: motionTokens.duration.standard,
        ease: motionTokens.ease.enter,
        delay: delay + 0.04,
      };
  if (kind === "number")
    return (
      <motion.span
        className={styles.glyph}
        initial={glyphFrom}
        animate={glyphRest}
        exit={exit}
        transition={pop}
      >
        {number}
      </motion.span>
    );
  return (
    <motion.svg
      className={`${styles.glyph} ${styles.icon}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={glyphFrom}
      animate={glyphRest}
      exit={exit}
      transition={pop}
    >
      {kind === "check" ? (
        <motion.path
          d="M5.5 12.5l4.25 4.25L18.5 8"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={draw}
        />
      ) : (
        <>
          <motion.path
            d="M12 6.75v6.5"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={draw}
          />
          <motion.circle
            cx={12}
            cy={17.4}
            r={1.4}
            fill="currentColor"
            stroke="none"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={reduced ? still : { ...motionTokens.spring.snappy, delay: delay + 0.16 }}
          />
        </>
      )}
    </motion.svg>
  );
}

/** The ring grows out from behind the disc once progress arrives, so the eye lands on the new step after the connector fills. */
function Marker({
  number,
  kind,
  current,
  glyphDelay,
  ringDelay,
  reduced,
}: {
  number: number;
  kind: GlyphKind;
  current: boolean;
  glyphDelay: number;
  ringDelay: number;
  reduced: boolean;
}) {
  return (
    <span className={styles.marker} aria-hidden="true">
      <AnimatePresence initial={false}>
        {current ? (
          <motion.span
            key="ring"
            className={styles.ring}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6, transition: reduced ? still : leave }}
            transition={
              reduced
                ? still
                : {
                    scale: { ...motionTokens.spring.snappy, delay: ringDelay },
                    opacity: { duration: motionTokens.duration.fast, delay: ringDelay },
                  }
            }
          />
        ) : null}
      </AnimatePresence>
      <span className={styles.disc}>
        <AnimatePresence initial={false}>
          <Glyph key={kind} kind={kind} number={number} delay={glyphDelay} reduced={reduced} />
        </AnimatePresence>
      </span>
    </span>
  );
}

const statusText: Record<StepperStatus, string> = {
  complete: "Completed",
  current: "",
  upcoming: "Pending",
  error: "Error",
};

export function Stepper({
  steps,
  current,
  completed,
  selectable = "completed",
  disabled = false,
  orientation = "horizontal",
  onStepSelect,
  details = "all",
  compact = false,
  label = t("Progress"),
  completeLabel = t("Completed"),
  className,
}: StepperProps) {
  useLocale();
  const statusId = useId();
  const reduced = useReducedMotion() ?? false;
  const count = steps.length;
  const active = Math.min(Math.max(Math.round(current), 0), count);
  // Remember where progress came from, so a jump across several steps fills or drains its connectors one after another.
  const [travel, setTravel] = useState({ to: active, from: active });
  if (travel.to !== active) setTravel({ to: active, from: travel.to });
  const from = travel.from;
  const gap = motionTokens.stagger.line;
  const delayAt = (index: number) => {
    if (reduced) return 0;
    if (active > from) return index >= from && index < active ? (index - from) * gap : 0;
    return index >= active && index < from ? (from - 1 - index) * gap : 0;
  };
  const ringDelay = reduced ? 0 : Math.max(0, Math.abs(active - from) - 1) * gap + 0.12;
  const interactive = Boolean(onStepSelect);
  const vertical = orientation === "vertical";
  const done = active >= count;
  const now = done ? undefined : steps[active];

  /** Arrow keys move between the steps you can reach; Home and End jump to the first and the current one. */
  function onKeyDown(event: KeyboardEvent<HTMLOListElement>) {
    if (isImeComposition(event.nativeEvent)) return;
    const rtl = !vertical && getComputedStyle(event.currentTarget).direction === "rtl";
    const back = ["ArrowUp", rtl ? "ArrowRight" : "ArrowLeft"],
      ahead = ["ArrowDown", rtl ? "ArrowLeft" : "ArrowRight"];
    if (![...back, ...ahead, "Home", "End"].includes(event.key)) return;
    const targets = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-reachable]"),
    );
    const at = targets.indexOf(event.target as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? targets.length - 1
          : back.includes(event.key)
            ? Math.max(0, at - 1)
            : Math.min(targets.length - 1, at + 1);
    targets[next]?.focus();
  }

  const Root = interactive ? "nav" : "div";
  const classes = [
    "bycoda-arc",
    styles.root,
    vertical ? styles.vertical : styles.horizontal,
    compact ? styles.compact : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Root className={classes} aria-label={label} role={interactive ? undefined : "group"}>
      <ol
        className={styles.list}
        style={
          vertical
            ? undefined
            : {
                gridTemplateColumns:
                  count > 1 ? `repeat(${count - 1}, minmax(0, 1fr)) auto` : "auto",
              }
        }
        onKeyDown={interactive ? onKeyDown : undefined}
      >
        {steps.map((step, index) => {
          const isCurrent = index === active;
          const isComplete = completed ? completed.includes(step.id) : index < active;
          const status: StepperStatus = step.error
            ? "error"
            : isCurrent
              ? "current"
              : isComplete
                ? "complete"
                : "upcoming";
          const reachable =
            selectable === "all" ||
            (selectable === "completed" ? isComplete : selectable.includes(step.id));
          const clickable = interactive && !disabled && !step.disabled && reachable;
          const detail =
            step.error ?? (details === "all" || isCurrent ? step.description : undefined);
          const kind: GlyphKind = step.error
            ? "error"
            : isComplete && !isCurrent
              ? "check"
              : "number";
          const content: ReactNode = (
            <>
              <Marker
                number={index + 1}
                kind={kind}
                current={isCurrent}
                glyphDelay={delayAt(index)}
                ringDelay={ringDelay}
                reduced={reduced}
              />
              <span className={styles.text}>
                <span className={styles.label}>{step.label}</span>
                <span id={`${statusId}-${index}`} className={styles.srOnly}>
                  {statusText[status] ? t(statusText[status]) : ""}
                  {detail ? ` ${detail}` : ""}
                </span>
                <SwapText
                  text={detail}
                  className={step.error ? styles.error : styles.description}
                  reduced={reduced}
                />
              </span>
            </>
          );
          return (
            <li
              key={step.id}
              className={styles.item}
              data-status={status}
              aria-current={isCurrent ? "step" : undefined}
            >
              {index < count - 1 ? (
                <span className={styles.connector} aria-hidden="true">
                  <motion.span
                    key={orientation}
                    className={styles.fill}
                    initial={false}
                    animate={
                      vertical ? { scaleY: isComplete ? 1 : 0 } : { scaleX: isComplete ? 1 : 0 }
                    }
                    transition={
                      reduced ? still : { ...motionTokens.spring.smooth, delay: delayAt(index) }
                    }
                  />
                </span>
              ) : null}
              {interactive ? (
                <Button
                  type="button"
                  variant="tab"
                  motion="none"
                  className={styles.head}
                  style={{ display: "grid", blockSize: "auto", inlineSize: "100%" }}
                  aria-label={`${index + 1} ${step.label}`}
                  aria-describedby={`${statusId}-${index}`}
                  disabled={disabled || step.disabled}
                  data-clickable={clickable || undefined}
                  data-reachable={clickable || undefined}
                  aria-disabled={clickable ? undefined : true}
                  tabIndex={clickable ? undefined : -1}
                  onClick={clickable ? () => onStepSelect?.(index) : undefined}
                >
                  {content}
                </Button>
              ) : (
                <span className={styles.head}>{content}</span>
              )}
            </li>
          );
        })}
      </ol>
      {vertical ? null : (
        <span className={styles.caption} aria-hidden="true">
          <SwapText
            text={now?.label ?? completeLabel}
            className={styles.captionLabel}
            reduced={reduced}
          />
          <SwapText
            text={now?.error ?? now?.description}
            className={now?.error ? styles.error : styles.description}
            reduced={reduced}
          />
        </span>
      )}
      <span className={styles.srOnly} aria-live="polite">
        {now ? `${active + 1}/${count}: ${now.label}` : completeLabel}
      </span>
    </Root>
  );
}

export default Stepper;
