"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import { Tooltip } from "../../Tooltip";
import styles from "./segmented-control.module.css";

export interface Segment {
  value: string;
  label: string;
  /** Full label when the visible label is abbreviated. */
  tooltip?: string;
  /** Optional leading icon before the label. Decorative: the label stays the accessible name.
   *  With `iconOnly`, only the icon shows and the label becomes the accessible name. */
  icon?: ReactNode;
  /** Hide the visible label (needs `icon`); the label remains the accessible name and tooltip. */
  iconOnly?: boolean;
  /** Optional content after the label, such as a badge. */ accessory?: ReactNode;
  /** Unavailable option: stays visible, is skipped by arrow keys and cannot be chosen. */
  disabled?: boolean;
}
export interface SegmentedControlProps {
  /** Overall control height; sm fits compact toolbars without adding tray height. */
  size?: "sm" | "md";
  /** Equal-width, compact steps; labels hide below a narrow container width. */
  compact?: boolean;
  options: Segment[];
  value: string;
  onValueChange: (value: string) => void;
  label?: string;
  /** Called when the pointer or focus reaches an option, before it is chosen. Use it to start loading what that option shows. */
  onOptionIntent?: (value: string) => void;
  className?: string;
  /** Keep existing settings radio semantics and searchable DOM ids. */
  selectionRole?: "pressed" | "radio";
  optionIdPrefix?: string;
}

export default function SegmentedControl({
  options,
  size = "md",
  compact = false,
  value,
  onValueChange,
  label,
  onOptionIntent,
  className,
  selectionRole = "pressed",
  optionIdPrefix,
}: SegmentedControlProps) {
  const id = useId();
  const reduced = useReducedMotion();
  const track = useRef<HTMLDivElement>(null);

  // When the options are wider than the container, the track scrolls inside itself. Edges fade only on the side with more to see.
  useLayoutEffect(() => {
    const node = track.current;
    if (!node) return;
    const edges = () => {
      const rest = node.scrollWidth - node.clientWidth - node.scrollLeft;
      node.toggleAttribute("data-fade-start", node.scrollLeft > 1);
      node.toggleAttribute("data-fade-end", rest > 1);
    };
    edges();
    node.addEventListener("scroll", edges, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(edges);
    observer?.observe(node);
    return () => {
      node.removeEventListener("scroll", edges);
      observer?.disconnect();
    };
  }, [options.length]);

  // The selected option is always scrolled fully into view, with a little room so it clears the fade.
  const first = useRef(true);
  useEffect(() => {
    const node = track.current;
    const button = node?.querySelector<HTMLElement>('[data-selected="true"]');
    if (!node || !button || node.scrollWidth <= node.clientWidth) {
      first.current = false;
      return;
    }
    // Measure from the track itself: offsetLeft would be relative to an outer positioned ancestor.
    const offset =
      button.getBoundingClientRect().left - node.getBoundingClientRect().left + node.scrollLeft;
    const room = 20,
      start = offset - room,
      end = offset + button.offsetWidth + room - node.clientWidth;
    const left = node.scrollLeft > start ? start : node.scrollLeft < end ? end : node.scrollLeft;
    if (left !== node.scrollLeft)
      node.scrollTo({
        left: Math.max(0, left),
        behavior: first.current || reduced ? "auto" : "smooth",
      });
    first.current = false;
  }, [value, reduced]);

  // Arrow keys, Home and End move the selection like a tab list; only the selected option is a tab stop.
  // Disabled options stay in place but are skipped.
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const enabled = options.flatMap((option, index) => (option.disabled ? [] : [index]));
  // A disabled selection cannot take focus, so the first enabled option remains reachable.
  const tabStop = options[selectedIndex]?.disabled ? (enabled[0] ?? selectedIndex) : selectedIndex;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = options.findIndex(
      (option) => option.value === event.currentTarget.dataset.value,
    );
    const from = currentIndex < 0 ? selectedIndex : currentIndex;
    const step = (delta: 1 | -1) => {
      for (let offset = 1; offset <= options.length; offset++) {
        const index =
          (((from + delta * offset) % options.length) + options.length) % options.length;
        if (!options[index]?.disabled) return index;
      }
      return -1;
    };
    const target =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? step(1)
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? step(-1)
          : event.key === "Home"
            ? (enabled[0] ?? -1)
            : event.key === "End"
              ? (enabled[enabled.length - 1] ?? -1)
              : -1;
    if (target < 0 || !options[target]) return;
    event.preventDefault();
    event.stopPropagation();
    onValueChange(options[target].value);
    track.current
      ?.querySelectorAll<HTMLButtonElement>("button[data-value]")
      [target]?.focus({ preventScroll: true });
  };

  return (
    <div
      className={`${styles.root} ${className ?? ""}`}
      data-compact={compact || undefined}
      data-size={size}
      role={selectionRole === "radio" ? "radiogroup" : "group"}
      aria-label={label}
    >
      <LayoutGroup id={id}>
        <motion.div ref={track} layoutScroll className={styles.track}>
          {options.map((option, index) => {
            const iconOnly = !!option.iconOnly && option.icon != null;
            const button = (
              <button
                key={iconOnly ? undefined : option.value}
                id={
                  optionIdPrefix
                    ? `${optionIdPrefix}-${option.value.toLowerCase()}`
                    : `${id}-${option.value}`
                }
                className={styles.button}
                type="button"
                data-value={option.value}
                data-icon-only={iconOnly || undefined}
                data-selected={value === option.value}
                role={selectionRole === "radio" ? "radio" : undefined}
                aria-checked={selectionRole === "radio" ? value === option.value : undefined}
                aria-pressed={selectionRole === "pressed" ? value === option.value : undefined}
                tabIndex={index === tabStop ? 0 : -1}
                disabled={option.disabled}
                aria-label={
                  option.tooltip ??
                  (option.iconOnly && option.icon != null ? option.label : undefined)
                }
                onClick={() => onValueChange(option.value)}
                onKeyDown={onKeyDown}
                onPointerEnter={onOptionIntent ? () => onOptionIntent(option.value) : undefined}
                onFocus={onOptionIntent ? () => onOptionIntent(option.value) : undefined}
              >
                {value === option.value && (
                  <motion.span
                    className={styles.selection}
                    layoutId="selection"
                    layoutDependency={value}
                    transition={reduced ? { duration: 0 } : motionTokens.spring.morph}
                    aria-hidden="true"
                  />
                )}
                <span className={styles.label}>
                  {option.icon != null ? (
                    <span className={styles.icon} aria-hidden="true">
                      {option.icon}
                    </span>
                  ) : null}
                  {option.iconOnly && option.icon != null ? null : (
                    <span className={styles.copy}>{option.label}</span>
                  )}
                  {option.accessory != null ? (
                    <span className={styles.accessory}>{option.accessory}</span>
                  ) : null}
                </span>
              </button>
            );
            return iconOnly || option.tooltip ? (
              <Tooltip key={option.value} label={option.tooltip ?? option.label}>
                {button}
              </Tooltip>
            ) : (
              button
            );
          })}
        </motion.div>
      </LayoutGroup>
    </div>
  );
}
