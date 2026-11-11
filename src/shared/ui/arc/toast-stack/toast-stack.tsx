// Official free Arc registry source, adapted to bycoda shared semantics.
// Local changes: the store, provider and viewport are gone, because the shared ToastRegion owns
// the corners, the queue and the portals (a component-owned toast keeps its React context). What
// stays is the stack geometry, mirrored for a top edge, the item motion and the card anatomy,
// which takes React content and shared Button slots. Swipe is left out so toast text stays
// selectable; the hotkey and Escape belong to the keybinding and overlay owners.
"use client";

import { createContext, useContext, useLayoutEffect, useRef } from "react";
import type { HTMLAttributes, ReactNode, Ref } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  type MotionValue,
  type Transition,
} from "motion/react";
import { useStableCallback } from "../../../hooks/useStableCallback";
import { observeResize } from "../../../lib/observeResize";
import { CheckCircle, CircleX, Info, TriangleAlert } from "../../icons";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./toast-stack.module.css";

export type ToastStackTone = "neutral" | "info" | "success" | "warning" | "danger";
/** The window edge the stack hangs from: toasts enter from beyond it and tuck away from it. */
export type ToastStackEdge = "top" | "bottom";
export type ToastStackTarget = {
  y: number;
  scale: number;
  height: number;
  opacity: number;
  content: number;
};

/** Each tucked toast shows this many pixels beyond the one in front of it. */
const PEEK = 14;
/** Space between toasts when the stack is open. */
const GAP = 12;
/** Tucked toasts shrink by this much per step back. */
const STEP = 0.05;
/** The card's top and bottom borders, added to the measured content height. */
const BORDER = 2;
/** How many toasts show at once. Older ones wait behind and return as the front ones close. */
export const TOAST_STACK_VISIBLE = 3;

const standard = [...motionTokens.ease.standard] as [number, number, number, number];
const enterEase = [...motionTokens.ease.enter] as [number, number, number, number];
const fade: Transition = { duration: motionTokens.duration.fast, ease: standard };
const enterFade: Transition = { duration: motionTokens.duration.standard, ease: enterEase };

/** Class of the element the items hang in. Its block size is the `listHeight` of the layout. */
export const toastStackClassName = styles.stack;

/**
 * Closed, tucked toasts take the front toast's height so their edges line up; open, each takes its
 * own and they stack with a gap. `heights` runs from the front toast back. The list is the hover
 * target and is sized to cover the gaps, so moving between open toasts never collapses the stack.
 */
export function layoutStack(
  heights: readonly number[],
  expanded: boolean,
  edge: ToastStackEdge = "bottom",
  visible = TOAST_STACK_VISIBLE,
) {
  const away = edge === "bottom" ? -1 : 1;
  const front = heights[0] ?? 0;
  let offset = 0;
  const targets = heights.map((own, index): ToastStackTarget => {
    const shown = index < visible;
    const depth = Math.min(index, visible);
    const target = expanded
      ? { y: away * offset || 0, scale: 1, height: own, opacity: shown ? 1 : 0, content: 1 }
      : {
          y: away * PEEK * depth || 0,
          scale: 1 - STEP * depth,
          height: index === 0 ? own : front,
          opacity: shown ? 1 : 0,
          content: index === 0 ? 1 : 0,
        };
    if (shown) offset += own + GAP;
    return target;
  });
  const count = Math.min(heights.length, visible);
  const listHeight = !count ? 0 : expanded ? offset - GAP : front + PEEK * (count - 1);
  return { targets, listHeight };
}

type ItemContext = {
  paused: boolean;
  contentOpacity: MotionValue<number>;
  measure: (height: number) => void;
};
const ToastStackItemContext = createContext<ItemContext | null>(null);

/** Inside a stack item: whether its expiry is held, by an open stack or by waiting behind the visible toasts. `null` outside a stack. */
export function useToastStackItem(): { paused: boolean } | null {
  return useContext(ToastStackItemContext);
}

export interface ToastStackItemProps {
  /** Where the stack puts this toast; `null` until the stack has placed it. */
  target: ToastStackTarget | null;
  expanded: boolean;
  front: boolean;
  /** Waiting behind the visible toasts: out of the tab order and the accessibility tree. */
  hidden: boolean;
  edge: ToastStackEdge;
  /** Newer toasts sit above older ones. */
  zIndex: number;
  onMeasure: (height: number) => void;
  /** Keeps the stack's container mounted while a leaving copy fades; returns the release. */
  retain: () => () => void;
  children: ReactNode;
}

/**
 * The copy is a picture of the toast, not a second one: nothing in it may be announced, focused
 * or found as a control, so its controls become plain boxes and its names and roles go.
 */
function fadeCopy(
  parent: HTMLElement,
  copy: HTMLElement,
  toward: number,
  reduce: boolean,
  done: () => void,
) {
  for (const control of copy.querySelectorAll("button, a")) {
    const box = document.createElement("span");
    for (const { name, value } of control.attributes) box.setAttribute(name, value);
    box.append(...control.childNodes);
    control.replaceWith(box);
  }
  for (const node of [copy, ...copy.querySelectorAll("*")])
    for (const name of ["role", "id", "aria-label", "data-toast-tone"]) node.removeAttribute(name);
  copy.setAttribute("aria-hidden", "true");
  copy.setAttribute("inert", "");
  copy.dataset.toastLeaving = "";
  parent.append(copy);
  const finish = () => {
    copy.remove();
    done();
  };
  if (typeof copy.animate !== "function") return finish();
  // A closed toast sinks toward its edge while it fades.
  copy
    .animate(
      reduce ? { opacity: 0 } : { opacity: 0, translate: `0 ${toward * 10}px`, scale: 0.96 },
      {
        duration: motionTokens.duration.exit * 1000,
        easing: `cubic-bezier(${standard.join(",")})`,
        fill: "forwards",
      },
    )
    .finished.then(finish, finish);
}

/**
 * One toast in a stack: follows the target the stack gives it, enters from beyond the edge and
 * leaves as a fading copy. Render a `ToastStackCard` inside.
 */
export function ToastStackItem({
  target,
  expanded,
  front,
  hidden,
  edge,
  zIndex,
  onMeasure,
  retain,
  children,
}: ToastStackItemProps) {
  const reduce = !!useReducedMotion();
  const itemRef = useRef<HTMLDivElement>(null);
  // Stack geometry lives in motion values, so following the stack never re-renders React per frame.
  const y = useMotionValue(0);
  const scale = useMotionValue(1);
  const height = useMotionValue(0);
  const opacity = useMotionValue(0);
  const contentOpacity = useMotionValue(1);
  /** The expanded state the last target was applied under; null until the toast has entered. */
  const applied = useRef<boolean | null>(null);
  const measure = useStableCallback(onMeasure);
  const hold = useStableCallback(retain);
  const toward = edge === "bottom" ? 1 : -1;
  const placed = target !== null && target.height > 0;
  const targetY = target?.y ?? 0;
  const targetScale = target?.scale ?? 1;
  const targetHeight = target?.height ?? 0;
  const targetOpacity = target?.opacity ?? 0;
  const targetContent = target?.content ?? 1;

  // Every stack change retargets the running springs from wherever they are, so rapid toasts and hover changes never queue.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- drives the motion values to the stack target before paint
  useLayoutEffect(() => {
    if (!placed) return;
    const entering = applied.current === null;
    const morph = !entering && applied.current !== expanded;
    applied.current = expanded;
    if (reduce) {
      y.jump(targetY);
      scale.jump(targetScale);
      height.jump(targetHeight);
      animate(opacity, targetOpacity, fade);
      animate(contentOpacity, targetContent, fade);
      return;
    }
    if (entering) {
      y.jump(targetY + toward * targetHeight);
      scale.jump(targetScale);
      height.jump(targetHeight);
      contentOpacity.jump(targetContent);
      opacity.jump(0);
    }
    const spring = morph ? motionTokens.spring.morph : motionTokens.spring.smooth;
    animate(y, targetY, spring);
    animate(scale, targetScale, spring);
    if (!entering) animate(height, targetHeight, spring);
    animate(opacity, targetOpacity, entering ? enterFade : fade);
    animate(contentOpacity, targetContent, fade);
  }, [
    contentOpacity,
    expanded,
    height,
    opacity,
    placed,
    reduce,
    scale,
    targetContent,
    targetHeight,
    targetOpacity,
    targetScale,
    targetY,
    toward,
    y,
  ]);

  // Leaving: the owner unmounts its toast at once, so a copy of the card fades out where it stood.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- copies the DOM node on unmount, before React removes it
  useLayoutEffect(() => {
    const node = itemRef.current;
    if (!node) return;
    return () => {
      const parent = node.parentElement;
      if (!parent || opacity.get() <= 0) return;
      const release = hold();
      // A toast that was never laid out or shown leaves nothing behind.
      if (!node.offsetHeight) return release();
      const copy = node.cloneNode(true) as HTMLElement;
      queueMicrotask(() => {
        // An effect replay keeps the node in place; only a real removal leaves a copy behind.
        if (node.isConnected) release();
        else fadeCopy(parent, copy, toward, reduce, release);
      });
    };
  }, [hold, opacity, reduce, toward]);

  return (
    <motion.div
      ref={itemRef}
      className={styles.item}
      style={{ y, scale, height, opacity, zIndex }}
      data-toast-item=""
      data-edge={edge}
      data-front={front}
      data-expanded={expanded}
      inert={hidden}
    >
      {/* A toast waiting behind the visible ones keeps its time until it returns. */}
      <ToastStackItemContext.Provider
        value={{ paused: expanded || hidden, contentOpacity, measure }}
      >
        {children}
      </ToastStackItemContext.Provider>
    </motion.div>
  );
}

/** Each tone has its own glyph, so the tone is never carried by colour alone. */
const icons = {
  neutral: Info,
  info: Info,
  success: CheckCircle,
  warning: TriangleAlert,
  danger: CircleX,
};

export interface ToastStackCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  ref?: Ref<HTMLDivElement>;
  /** Drives the glyph and the role: danger announces assertively, the others politely. */
  tone?: ToastStackTone;
  title?: string;
  /** Under the title; on its own it is the toast's one line. */
  description?: ReactNode;
  /** One action at the end of the row; it drops under the copy when the card is narrow. */
  action?: ReactNode;
  /** The dismiss control, in the corner. */
  close?: ReactNode;
  /** Extra body under the copy: rows, progress, answers to a question. */
  children?: ReactNode;
}

/**
 * The toast card: tone glyph, title, description, body, one action and a dismiss control. Inside a
 * `ToastStackItem` it fills the item and reports its height; on its own it is a static card.
 */
export function ToastStackCard({
  ref,
  tone = "info",
  title,
  description,
  action,
  close,
  children,
  className,
  role,
  ...props
}: ToastStackCardProps) {
  const item = useContext(ToastStackItemContext);
  const content = useRef<HTMLDivElement>(null);
  const measure = item?.measure;
  const Icon = icons[tone];

  // Measured before the first paint, so the toast enters from exactly its own height beyond the edge.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- reports the content height to the stack and follows its resizes
  useLayoutEffect(() => {
    const node = content.current;
    if (!node || !measure) return;
    measure(node.offsetHeight + BORDER);
    return observeResize(node, () => measure(node.offsetHeight + BORDER));
  }, [measure]);

  return (
    <div
      {...props}
      ref={ref}
      className={[styles.card, item && styles.stacked, "bycoda-arc", className]
        .filter(Boolean)
        .join(" ")}
      role={role ?? (tone === "danger" ? "alert" : "status")}
      data-toast-tone={tone}
    >
      <motion.div
        ref={content}
        className={styles.content}
        style={item ? { opacity: item.contentOpacity } : undefined}
      >
        <span className={styles.icon} data-tone={tone} aria-hidden="true">
          <Icon width={18} height={18} strokeWidth={1.75} />
        </span>
        <div className={styles.copy}>
          {title ? <strong className={styles.title}>{title}</strong> : null}
          {description ? <div className={styles.description}>{description}</div> : null}
          {children ? <div className={styles.body}>{children}</div> : null}
        </div>
        {action ? <div className={styles.actionSlot}>{action}</div> : null}
        {close ? <div className={styles.closeSlot}>{close}</div> : null}
      </motion.div>
    </div>
  );
}
