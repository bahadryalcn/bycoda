"use client";

import { forwardRef, useState } from "react";
import type { ButtonHTMLAttributes } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { TargetAndTransition } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onDrag" | "onDragEnd" | "onDragStart" | "onAnimationStart"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

/* One quick press for every size: a 2% push, back on release, drawn by the stylesheet (`.pressable`) so an idle button carries no
   motion runtime. Menu and popup triggers never scale (see the stylesheet) and answer with a tone step instead. */

const iconOut: TargetAndTransition = { opacity: 0, scale: .6, transition: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } };
const fadeOut: TargetAndTransition = { opacity: 0, transition: { duration: motionTokens.duration.instant } };
/** Scale rides the spring; opacity uses a bounded tween. */
const iconEnter = { ...motionTokens.spring.snappy, opacity: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.enter] },} as const;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading = false, disabled, children, onClick, ...props },
  ref,
) {
  const reduceMotion = useReducedMotion() ?? false;
  // Action labels update immediately. Animating intrinsic width moves neighboring
  // controls every frame and temporarily clips longer localized labels.
  // The loader's presence layer mounts the first time it is needed and stays for its exit; a button that never loads pays nothing.
  const [startedLoading] = useState(loading);
  const [loaderMounted, setLoaderMounted] = useState(loading);
  if (loading && !loaderMounted) setLoaderMounted(true);
  // A trigger that anchors a menu, popover, or dialog keeps its rect still while pressed, so the layer never measures a scaled anchor.
  // Radix triggers (asChild) pass aria-haspopup or data-state through; the stylesheet repeats the guard.
  const popup = props["aria-haspopup"];
  const anchorsLayer = (popup !== undefined && popup !== false && popup !== "false") || props.role === "combobox" || (props as Record<string, unknown>)["data-state"] !== undefined;
  const inert = disabled || loading || props["aria-disabled"] === true || props["aria-disabled"] === "true";
  const pressable = !(reduceMotion || anchorsLayer || inert);
  const classes = [styles.button, styles[variant], styles[size], pressable ? styles.pressable : "", className].filter(Boolean).join(" ");

  return (
    <button
      ref={ref}
      tabIndex={props.tabIndex ?? 0}
      className={classes}
      disabled={disabled}
      aria-busy={loading || undefined}
      {...props}
      // Loading keeps the button focusable (a disabled button would drop keyboard focus mid-action) and swallows presses instead.
      aria-disabled={loading || props["aria-disabled"] || undefined}
      onClick={loading ? event => event.preventDefault() : onClick}
    >
      {loaderMounted ? <AnimatePresence initial={!startedLoading}>
        {loading ? <motion.span key="loader" className={styles.loader} aria-hidden="true" initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: .6 }} animate={{ opacity: 1, scale: 1 }} exit={reduceMotion ? fadeOut : { ...iconOut, scale: .8 }} transition={reduceMotion ? { duration: motionTokens.duration.instant } : iconEnter}><span className={styles.spinner} /></motion.span> : null}
      </AnimatePresence> : null}
      <span className={[styles.labelSlot, loading ? styles.loadingLabel : ""].filter(Boolean).join(" ")}>
        <span className={styles.labelContent}>
          <span className={styles.labelPhase}>{children}</span>
        </span>
      </span>
    </button>
  );
});

Button.displayName = "Button";

export default Button;
