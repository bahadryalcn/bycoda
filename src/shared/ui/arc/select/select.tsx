"use client";

import { forwardRef, useState } from "react";
import type { ComponentPropsWithoutRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Variants } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./select.module.css";
import { ComboboxItem } from "../combobox/combobox";
import { ChevronDown } from "../../icons";

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

/**
 * Composable parts for bycoda's existing native/web overlay lifecycle. `expanded` sets
 * `aria-expanded` and draws the turning trailing chevron after the children; leave it unset
 * when the caller draws its own end mark.
 */
export const SelectTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<"button"> & { expanded?: boolean; controlWidth?: "compact" }
>(function SelectTrigger({ className, expanded, controlWidth, children, ...props }, ref) {
  return (
    <button
      aria-expanded={expanded}
      {...props}
      data-select-width={controlWidth}
      ref={ref}
      className={[styles.trigger, "bycoda-arc", className].filter(Boolean).join(" ")}
    >
      {children}
      {expanded === undefined ? null : (
        <ChevronDown
          className={`bycoda-arc-select-chevron size-3.5 shrink-0 ${expanded ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      )}
    </button>
  );
});

/** The popup row shared with SearchableSelect (see ComboboxItem), so short and searchable pickers read alike. */
export const SelectOption = ComboboxItem;

/**
 * The label is visible from the first paint. The roll runs only after the value changes, never on
 * mount, so a trigger can not stay blank when an enter animation is delayed or never starts.
 */
export function SelectValue({ value, label }: { value: string; label: string }) {
  const reduced = useReducedMotion();
  const [seen, setSeen] = useState(value);
  const [changed, setChanged] = useState(false);
  if (seen !== value) {
    setSeen(value);
    setChanged(true);
  }
  if (reduced) return <span className={styles.valueText}>{label}</span>;
  return (
    <span className={styles.valueText}>
      {/* Keep one label in the trigger, including during rapid value changes. */}
      <motion.span
        key={value}
        variants={valueRoll}
        custom={1}
        initial={changed ? "enter" : false}
        animate="center"
      >
        {label}
      </motion.span>
    </span>
  );
}
