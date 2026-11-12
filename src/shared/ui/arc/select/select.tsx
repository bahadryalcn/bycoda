"use client";

import { forwardRef } from "react";
import type { ComponentPropsWithoutRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Variants } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./select.module.css";
import { ComboboxItem } from "../combobox/combobox";

/** The shown value rolls in the direction of the list: a later option rises from below, an earlier one drops from above. */
const valueRoll: Variants = {
  enter: (direction: number) => ({
    opacity: 0,
    y: `${direction * 0.35}em`,
  }),
  center: {
    opacity: 1,
    y: 0,
    transition: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] },
  },
  exit: (direction: number) => ({
    opacity: 0,
    y: `${direction * -0.3}em`,
    transition: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] },
  }),
};
/** Reduced motion keeps a short crossfade; the resting state matches valueRoll so server and client markup agree. */
const valueFade: Variants = {
  enter: { opacity: 0 },
  center: {
    opacity: 1,
    y: 0,
    transition: { duration: motionTokens.duration.instant },
  },
  exit: { opacity: 0, transition: { duration: motionTokens.duration.instant } },
};

/** Composable parts for bycoda's existing native/web overlay lifecycle. */
export const SelectTrigger = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button">>(
  function SelectTrigger({ className, ...props }, ref) {
    return (
      <button
        {...props}
        ref={ref}
        className={[styles.trigger, "bycoda-arc", className].filter(Boolean).join(" ")}
      />
    );
  },
);

/** The popup row shared with SearchableSelect (see ComboboxItem), so short and searchable pickers read alike. */
export const SelectOption = ComboboxItem;

export function SelectValue({ value, label }: { value: string; label: string }) {
  const reduced = useReducedMotion();
  if (reduced) return <span className={styles.valueText}>{label}</span>;
  return (
    <span className={styles.valueText}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          variants={reduced ? valueFade : valueRoll}
          custom={1}
          initial="enter"
          animate="center"
          exit="exit"
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
