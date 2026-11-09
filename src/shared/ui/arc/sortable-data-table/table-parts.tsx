"use client";

import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { ArrowUp } from "../../icons";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  type Transition,
  type Variants,
} from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./sortable-data-table.module.css";

export const enter: Transition = {
  duration: motionTokens.duration.standard,
  ease: [...motionTokens.ease.enter],
};
export const leave: Transition = {
  duration: motionTokens.duration.fast,
  ease: [...motionTokens.ease.standard],
};
export const instant: Transition = { duration: motionTokens.duration.instant };
/** Changing text rises in from the side it is moving toward and lifts away on the other. */
const rise: Variants = {
  enter: (direction: number) => ({
    opacity: 0,
    y: `${0.3 * direction}em`,
  }),
  shown: { opacity: 1, y: "0em", transition: enter },
  gone: (direction: number) => ({
    opacity: 0,
    y: `${-0.3 * direction}em`,
    transition: leave,
  }),
};
/** Reduced motion keeps the same properties as rise (no travel, no blur) so the server and a reduced-motion client render identical styles. */
const fade: Variants = {
  enter: { opacity: 0, y: "0em" },
  shown: { opacity: 1, y: "0em", transition: instant },
  gone: { opacity: 0, y: "0em", transition: instant },
};
/** Check and dash share three points, so the header box morphs between all and some. */
const checkPath = "M4.25 9.25 L7.25 12.25 L13.75 5.75";
const dashPath = "M4.75 9 L9 9 L13.25 9";

/** Text that changes in place. The slot eases to the new width, so the words beside it never jump. */
export function Swap({
  value,
  direction,
  reduced,
  className,
}: {
  value: string;
  direction: number;
  reduced: boolean;
  className?: string;
}) {
  const inner = useRef<HTMLSpanElement>(null);
  const width = useMotionValue<number | string>("auto");
  useLayoutEffect(() => {
    const node = inner.current;
    if (!node) return;
    let settled = false;
    const measure = () => {
      const next = node.getBoundingClientRect().width;
      if (settled && !reduced) animate(width, next, motionTokens.spring.morph);
      else width.jump(next);
      settled = true;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [reduced, width]);
  return (
    <motion.span className={[styles.swap, className].filter(Boolean).join(" ")} style={{ width }}>
      <span ref={inner} className={styles.swapInner}>
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.span
            key={value}
            className={styles.swapText}
            custom={direction}
            variants={reduced ? fade : rise}
            initial="enter"
            animate="shown"
            exit="gone"
          >
            {value}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.span>
  );
}

/** The arrow fades in where a column becomes sorted and flips on a spring when the direction changes. */
export function SortGlyph({
  active,
  descending,
  reduced,
}: {
  active: boolean;
  descending: boolean;
  reduced: boolean;
}) {
  const rotate = useMotionValue(descending ? 180 : 0);
  const seen = useRef({ active, hiddenAt: -Infinity });
  useLayoutEffect(() => {
    const state = seen.current;
    if (active) {
      // Turn only while the arrow is visible; a freshly shown arrow starts pointing the right way.
      const visible = state.active || performance.now() - state.hiddenAt < 160;
      if (visible && !reduced) animate(rotate, descending ? 180 : 0, motionTokens.spring.snappy);
      else rotate.jump(descending ? 180 : 0);
    } else if (state.active) state.hiddenAt = performance.now();
    state.active = active;
  }, [active, descending, reduced, rotate]);
  const transition: Transition = reduced
    ? instant
    : active
      ? { opacity: enter, scale: motionTokens.spring.snappy }
      : { duration: motionTokens.duration.instant, ease: [...motionTokens.ease.standard] };
  return (
    <span className={styles.sortIcon} aria-hidden="true">
      <ArrowUp className={styles.sortHint} size={16} strokeWidth={1.75} />
      <motion.span
        className={styles.sortArrow}
        style={{ rotate }}
        initial={false}
        animate={active ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.6 }}
        transition={transition}
      >
        <ArrowUp size={16} strokeWidth={1.75} />
      </motion.span>
    </span>
  );
}

export function SelectBox({
  checked,
  mixed = false,
  label,
  nav,
  reduced,
  onToggle,
  inputRef,
}: {
  checked: boolean;
  mixed?: boolean;
  label: string;
  nav: "head" | "row";
  reduced: boolean;
  onToggle: (extend: boolean) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const local = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? local;
  const on = checked || mixed;
  useLayoutEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed, ref]);
  const opacity: Transition = {
    duration: on ? motionTokens.duration.instant : motionTokens.duration.fast,
    ease: [...motionTokens.ease.standard],
  };
  return (
    <label className={styles.selectHit}>
      <input
        ref={ref}
        type="checkbox"
        className={styles.selectInput}
        checked={checked}
        aria-label={label}
        data-nav={nav}
        onChange={(event) => onToggle((event.nativeEvent as MouseEvent).shiftKey === true)}
      />
      <span className={styles.selectBox} data-on={on || undefined} aria-hidden="true">
        <motion.span
          className={styles.selectFill}
          initial={false}
          animate={{ opacity: on ? 1 : 0, scale: on ? 1 : 0.6 }}
          transition={reduced ? { duration: 0 } : { scale: motionTokens.spring.snappy, opacity }}
        />
        <svg className={styles.selectMark} viewBox="0 0 18 18" fill="none" focusable="false">
          <motion.path
            initial={false}
            animate={{
              d: mixed ? dashPath : checkPath,
              pathLength: on ? 1 : 0,
              opacity: on ? 1 : 0,
            }}
            transition={
              reduced
                ? { duration: 0 }
                : { d: motionTokens.spring.morph, pathLength: motionTokens.spring.snappy, opacity }
            }
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </label>
  );
}
