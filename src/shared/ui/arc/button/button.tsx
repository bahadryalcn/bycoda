"use client";

import { forwardRef, isValidElement, useLayoutEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode, Ref, RefObject } from "react";
import { AnimatePresence, animate, motion, useIsPresent, useReducedMotion } from "motion/react";
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

const rest: TargetAndTransition = { opacity: 1, y: 0, scale: 1,};
/** Text rises about .3em with a short fade; the outgoing label lifts away a little faster. */
const textIn: TargetAndTransition = { opacity: 0, y: 4,};
const textOut: TargetAndTransition = { opacity: 0, y: -3, transition: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } };
const iconIn: TargetAndTransition = { opacity: 0, scale: .6,};
const iconOut: TargetAndTransition = { opacity: 0, scale: .6, transition: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } };
const fadeIn: TargetAndTransition = { ...rest, opacity: 0 };
const fadeOut: TargetAndTransition = { opacity: 0, transition: { duration: motionTokens.duration.instant } };
/** Scale rides the spring; opacity uses a bounded tween. */
const iconEnter = { ...motionTokens.spring.snappy, opacity: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.enter] },} as const;

/** A key for the label content: text plus element names, so a new label or icon crossfades while prop-only updates stay in place. */
function labelKey(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return String(node);
  if (Array.isArray(node)) return node.map(labelKey).join("");
  if (!isValidElement(node)) return "";
  const type = node.type as string | { displayName?: string; name?: string };
  return `<${typeof type === "string" ? type : type?.displayName ?? type?.name ?? ""}>${labelKey((node.props as { children?: ReactNode }).children)}`;
}

/** Springs the slot from the outgoing label's width to the incoming one when the label changes, so a new label never snaps the
 *  button's size. The outgoing label is popped out of flow at once, so it never holds the old width. Nothing is observed or measured
 *  until a label actually changes: the rest of the time the slot is sized by its content. */
function useMorphWidth(content: RefObject<HTMLElement | null>, key: string, reduced: boolean) {
  const lastKey = useRef(key);
  useLayoutEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    const node = content.current, slot = node?.parentElement;
    if (!node || !slot || reduced) return;
    // popLayout has taken the outgoing phase out of flow; its box still holds the old width.
    const outgoing = node.querySelector<HTMLElement>(':scope > [aria-hidden="true"]');
    const from = outgoing?.getBoundingClientRect().width ?? 0, to = node.getBoundingClientRect().width;
    if (!from || !to || Math.abs(from - to) < .5) return;
    slot.dataset.morphing = "";
    const release = () => { slot.style.width = ""; delete slot.dataset.morphing; };
    const animation = animate(slot, { width: [from, to] }, { ...motionTokens.spring.morph, onComplete: release });
    return () => { animation.stop(); release(); };
  }, [content, key, reduced]);
}

function LabelPhase({ children, icon, reduced, ref }: { children: ReactNode; icon: boolean; reduced: boolean; ref?: Ref<HTMLSpanElement> }) {
  const present = useIsPresent();
  return <motion.span ref={ref} className={styles.labelPhase} aria-hidden={present ? undefined : true} initial={reduced ? fadeIn : icon ? iconIn : textIn} animate={rest} exit={reduced ? fadeOut : icon ? iconOut : textOut} transition={reduced ? { duration: motionTokens.duration.instant } : icon ? iconEnter : { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }}>{children}</motion.span>;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading = false, disabled, children, onClick, ...props },
  ref,
) {
  const reduceMotion = useReducedMotion() ?? false;
  const contentRef = useRef<HTMLSpanElement>(null);
  const key = labelKey(children);
  // A label that never changes is a plain span: the presence layer (AnimatePresence + motion phase) mounts only when the label first
  // changes, in two steps so that first change still crossfades. Step one commits the outgoing label inside the presence layer, and a
  // layout effect (flushed before paint) then hands it the incoming one, which is when the exit/enter and width morph run.
  const [animatedLabel, setAnimatedLabel] = useState(false);
  const lastLabel = useRef<{ key: string; children: ReactNode }>({ key, children });
  const swapping = !animatedLabel && lastLabel.current.key !== key;
  const shown = swapping ? lastLabel.current : { key, children };
  useLayoutEffect(() => {
    if (animatedLabel) return;
    if (swapping) setAnimatedLabel(true);
    else lastLabel.current = { key, children };
  });
  useMorphWidth(contentRef, shown.key, reduceMotion);
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
        <span ref={contentRef} className={styles.labelContent}>
          {animatedLabel || swapping ? <AnimatePresence mode="popLayout" initial={false}>
            <LabelPhase key={shown.key} icon={!/\S/.test(shown.key.replace(/<[^>]*>/g, ""))} reduced={reduceMotion}>{shown.children}</LabelPhase>
          </AnimatePresence> : <span className={styles.labelPhase}>{children}</span>}
        </span>
      </span>
    </button>
  );
});

Button.displayName = "Button";

export default Button;
