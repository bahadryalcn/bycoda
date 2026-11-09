"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FocusEvent, KeyboardEvent, PointerEvent, ReactNode, Ref } from "react";
import { Button, type ButtonTone } from "../../Button";
import styles from "./expanding-button-group.module.css";

export type ExpandingButtonGroupSize = "sm" | "md";
export type ExpandingButtonGroupTone = ButtonTone;

/** A composite can own its menu while the group owns its action presentation. */
export interface ExpandingButtonGroupTriggerProps {
  ref?: Ref<HTMLButtonElement>;
  onSelect?: () => void | boolean | Promise<void | boolean>;
  disabled?: boolean;
  ariaLabel?: string;
  "aria-haspopup"?: "menu" | "dialog";
  "aria-expanded"?: boolean;
}

export interface ExpandingButtonGroupItem {
  /** Display only; the caller supplies the current binding. */
  shortcut?: string | null;
  /** Stable key for the action. Also the value passed to onAction. */
  id: string;
  /** Visible label once the button expands, and its accessible name at all times. Use a short verb, such as "Archive". */
  label: string;
  /** Icon shown while collapsed. A 16px lucide icon fits; it is sized by the group. */
  icon: ReactNode;
  /** Runs the action. Return false, or reject, to skip the confirmation. A promise keeps the button busy until it settles. */
  onSelect?: () => void | boolean | Promise<void | boolean>;
  /** Past tense word shown in place after the action, such as "Archived". The icon becomes a check for confirmDuration. Omit for actions that open something. */
  doneLabel?: string;
  /** "danger" colors the expanded state with the danger token, for destructive actions such as Delete. */
  tone?: ExpandingButtonGroupTone;
  /** Dimmed and inert. Stays focusable and still reveals its label, so people can learn what it would do. */
  disabled?: boolean;
  /** Persistent selection, independent of the temporary label expansion. */
  active?: boolean;
  ariaLabel?: string;
  onOpenContextMenu?: (x: number, y: number) => void;
  tooltip?: string;
  render?: (renderTrigger: (props: ExpandingButtonGroupTriggerProps) => ReactNode) => ReactNode;
}

export interface ExpandingButtonGroupProps {
  items: readonly ExpandingButtonGroupItem[];
  /** Accessible name of the toolbar, such as "Message actions". */
  label: string;
  size?: ExpandingButtonGroupSize;
  /** Shrink the revealed label to fit its container, preserving the icon minimum. */
  fit?: boolean;
  /** Fill the container and distribute spare space across the actions. */
  fullWidth?: boolean;
  /** Id of the action whose label shows at rest. Defaults to the first enabled action.
   * Pass null to keep all labels collapsed at rest. Pointer intent or keyboard focus
   * reveals a label; it returns to the resting state when the pointer and focus leave. */
  defaultExpanded?: string | null;
  /** Called with the item id whenever an action runs, before its own onSelect. */
  onAction?: (id: string) => void;
  /** How long the confirmation stays, in milliseconds. */
  confirmDuration?: number;
  /** `tray` draws the grouped surface; `bare` keeps flat icon buttons for headers and window chrome. */
  chrome?: "tray" | "bare";
  className?: string;
  style?: CSSProperties;
}

/** Geometry per size. The icon keeps the same left inset collapsed and expanded, so it never moves while the label is revealed. */
const metrics = {
  sm: { height: 28, icon: 14, start: 7, gap: 5, end: 11 },
  md: { height: 36, icon: 16, start: 10, gap: 7, end: 14 },
} as const;

/** Pixels the pointer must travel into a neighbouring action before the expansion moves to it. */
const hysteresis = 4;
// Filter a pointer passing over the row, and tolerate brief trips outside it, without making intended hover feel late.
const hoverDelay = 120;
const leaveDelay = 200;

/** The confirmation tick draws itself from its short stroke. */
function DrawnCheck() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path className={styles.check} d="M4 12.5l5 5L20 6.5" pathLength={1} />
    </svg>
  );
}

interface ItemProps {
  item: ExpandingButtonGroupItem;
  size: ExpandingButtonGroupSize;
  expanded: boolean;
  done: boolean;
  busy: boolean;
  tabStop: boolean;
  onPointerDown: (item: ExpandingButtonGroupItem, event: PointerEvent<HTMLButtonElement>) => void;
  onClick: (item: ExpandingButtonGroupItem) => void;
  onFocus: (item: ExpandingButtonGroupItem, event: FocusEvent<HTMLButtonElement>) => void;
}

function Item(props: ItemProps) {
  if (props.item.render) {
    return props.item.render((trigger) => (
      <ItemButton
        {...props}
        item={{
          ...props.item,
          ...trigger,
          disabled: props.item.disabled || trigger.disabled,
        }}
        trigger={trigger}
      />
    ));
  }
  return <ItemButton {...props} />;
}

function ItemButton({
  item,
  size,
  expanded,
  done,
  busy,
  tabStop,
  onPointerDown,
  onClick,
  onFocus,
  trigger,
}: ItemProps & { trigger?: ExpandingButtonGroupTriggerProps }) {
  const showDone = done && !!item.doneLabel;
  // The resting word and icon appear without motion; only a confirmation, and the return from it, animate in.
  const confirmed = useRef(false);
  useEffect(() => {
    if (showDone) confirmed.current = true;
  }, [showDone]);
  const swap = showDone || confirmed.current ? "" : undefined;
  const word = showDone ? item.doneLabel! : item.label;

  // The reveal is pure layout: the label's grid track grows from 0fr to 1fr in CSS. Nothing is measured, observed or animated
  // from script, so a transcript with many action rows stays cheap to mount and to hover.
  return (
    <Button
      ref={trigger?.ref}
      aria-haspopup={trigger?.["aria-haspopup"]}
      aria-expanded={trigger?.["aria-expanded"]}
      variant="ghost"
      motion="none"
      size={size}
      selected={item.active ?? expanded}
      tone={showDone ? "success" : (item.tone ?? "neutral")}
      type="button"
      className={styles.item}
      data-ebg-item=""
      data-id={item.id}
      data-tone={item.tone ?? "neutral"}
      data-state={showDone ? "done" : "idle"}
      data-expanded={expanded || undefined}
      aria-label={item.ariaLabel ?? item.label}
      title={item.tooltip ?? item.ariaLabel ?? item.label}
      tooltipWhen="overflow"
      shortcut={item.shortcut}
      aria-current={item.active ? "page" : undefined}
      onContextMenu={
        item.onOpenContextMenu
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              item.onOpenContextMenu?.(event.clientX, event.clientY);
            }
          : undefined
      }
      onKeyDown={
        item.onOpenContextMenu
          ? (event) => {
              if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
              event.preventDefault();
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              item.onOpenContextMenu?.(rect.left, rect.bottom);
            }
          : undefined
      }
      aria-disabled={item.disabled || busy || undefined}
      aria-busy={busy || undefined}
      tabIndex={tabStop ? 0 : -1}
      onPointerDown={(event) => onPointerDown(item, event)}
      onClick={() => onClick(item)}
      onFocus={(event) => onFocus(item, event)}
    >
      <span className={styles.icon} aria-hidden="true">
        <span key={showDone ? "done" : "icon"} className={styles.glyph} data-swap={swap}>
          {showDone ? <DrawnCheck /> : item.icon}
        </span>
      </span>
      <span className={styles.label} aria-hidden="true">
        <span className={styles.clip}>
          {/* Hidden copies of both words share one cell, so the confirmation swap never changes the width. */}
          <span className={styles.text}>
            <span key={word} className={styles.word} data-swap={swap}>
              {word}
            </span>
            <span className={styles.sizer}>{item.label}</span>
            {item.doneLabel ? <span className={styles.sizer}>{item.doneLabel}</span> : null}
          </span>
        </span>
      </span>
    </Button>
  );
}

/**
 * A compact tray of icon buttons for actions. One action always shows its label; the one you point at or focus takes over the
 * label while its neighbours slide aside, and an action can confirm in place: the icon draws a check and the label becomes a past tense word.
 * On touch, the first tap reveals the label and a second tap runs the action.
 */
export function ExpandingButtonGroup({
  fit = false,
  fullWidth = false,
  items,
  label,
  size = "md",
  defaultExpanded,
  onAction,
  confirmDuration = 1400,
  chrome = "tray",
  className,
  style,
}: ExpandingButtonGroupProps) {
  const root = useRef<HTMLDivElement>(null);
  const [intent, setIntent] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; seq: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [focused, setFocused] = useState<string | null>(null);

  // Refs mirror what the pointer and keyboard are doing right now, so leave and blur handlers can fall back correctly.
  const pointerOver = useRef<string | null>(null);
  const pointerAt = useRef<{ x: number; y: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverTarget = useRef<string | null>(null);
  const cancelHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    hoverTarget.current = null;
  };
  const keyFocus = useRef<string | null>(null);
  const touchOpen = useRef<string | null>(null);
  const press = useRef<{
    id: string;
    kind: string;
    wasExpanded: boolean;
  } | null>(null);
  const doneRef = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const seq = useRef(0);
  // State updates are batched; this synchronous latch also blocks two clicks in one tick.
  const running = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);

  const has = (id: string | null | undefined) => !!id && items.some((item) => item.id === id);
  // An explicit null opts into an icon-only resting state.
  const firstEnabled = items.find((item) => !item.disabled)?.id ?? items[0]?.id ?? null;
  const restId =
    defaultExpanded === null ? null : has(defaultExpanded) ? defaultExpanded : firstEnabled;
  const expandedId = busy ?? (has(intent) ? intent : restId);
  const tabStop = has(focused) ? focused : (restId ?? firstEnabled);

  // A tap outside closes a label opened by a first tap.
  useEffect(() => {
    if (!intent || touchOpen.current !== intent) return;
    const onDown = (event: globalThis.PointerEvent) => {
      if (root.current?.contains(event.target as Node)) return;
      touchOpen.current = null;
      setIntent(doneRef.current ?? keyFocus.current);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [intent]);

  const confirm = useCallback(
    (item: ExpandingButtonGroupItem) => {
      if (timer.current) clearTimeout(timer.current);
      seq.current += 1;
      doneRef.current = item.id;
      setDone({ id: item.id, seq: seq.current });
      // A zero width space alternates so the same word is announced again on a repeat action.
      setAnnouncement(`${item.doneLabel}${seq.current % 2 ? "" : "​"}`);
      timer.current = setTimeout(() => {
        doneRef.current = null;
        setDone(null);
        // Collapse unless the pointer or the keyboard is still on it.
        if (pointerOver.current !== item.id && keyFocus.current !== item.id) {
          if (touchOpen.current === item.id) touchOpen.current = null;
          setIntent((current) =>
            current === item.id ? (pointerOver.current ?? keyFocus.current) : current,
          );
        }
      }, confirmDuration);
    },
    [confirmDuration],
  );

  const activate = useCallback(
    async (item: ExpandingButtonGroupItem) => {
      if (item.disabled || running.current || doneRef.current === item.id) return;
      running.current = true;
      setIntent(item.id);
      let result: void | boolean;
      try {
        onAction?.(item.id);
        const pending = item.onSelect?.();
        if (typeof pending === "object" && pending !== null && "then" in pending) {
          setBusy(item.id);
          result = await pending;
        } else result = pending;
      } catch {
        result = false;
      } finally {
        running.current = false;
        if (mounted.current) setBusy((current) => (current === item.id ? null : current));
      }
      if (!mounted.current || result === false || !item.doneLabel) return;
      confirm(item);
    },
    [confirm, onAction],
  );

  const onItemPointerDown = (
    item: ExpandingButtonGroupItem,
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    cancelHover();
    press.current = {
      id: item.id,
      kind: event.pointerType,
      wasExpanded: expandedId === item.id,
    };
  };

  const onItemClick = (item: ExpandingButtonGroupItem) => {
    const last = press.current;
    press.current = null;
    // Touch has no hover: the first tap opens the label, the second runs it. An item already showing its label runs at once.
    if (last && last.id === item.id && last.kind === "touch" && !last.wasExpanded) {
      touchOpen.current = item.id;
      setIntent(item.id);
      return;
    }
    if (last?.kind === "touch") touchOpen.current = item.id;
    void activate(item);
  };

  const onItemFocus = (item: ExpandingButtonGroupItem, event: FocusEvent<HTMLButtonElement>) => {
    setFocused(item.id);
    // Only keyboard focus expands; a mouse click or a tap already has its own path, and would otherwise leave the label open.
    let visible = true;
    try {
      visible = event.currentTarget.matches(":focus-visible");
    } catch {
      /* older engines expand on any focus */
    }
    if (!visible) return;
    cancelHover();
    keyFocus.current = item.id;
    setIntent(item.id);
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (root.current?.contains(event.relatedTarget as Node | null)) return;
    keyFocus.current = null;
    touchOpen.current = null;
    setIntent(pointerOver.current ?? doneRef.current);
  };

  // Hover follows real pointer movement only. Expanding moves the buttons, and a button that slides under a resting pointer
  // must not take over, or two neighbours could trade places back and forth.
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.buttons !== 0) return;
    const at = pointerAt.current;
    if (at && Math.abs(at.x - event.clientX) < 1 && Math.abs(at.y - event.clientY) < 1) return;
    pointerAt.current = { x: event.clientX, y: event.clientY };
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-ebg-item]");
    const id = button?.dataset.id;
    if (!button || !id) {
      cancelHover();
      return;
    }
    if (id === expandedId) {
      cancelHover();
      pointerOver.current = id;
      return;
    }
    // Hysteresis: moving from one action to the next needs the pointer a few pixels inside the new one, so resting on a
    // boundary never flips between them.
    if (pointerOver.current) {
      const box = button.getBoundingClientRect();
      if (event.clientX < box.left + hysteresis || event.clientX > box.right - hysteresis) return;
    }
    pointerOver.current = id;
    if (hoverTarget.current === id) return;
    cancelHover();
    hoverTarget.current = id;
    hoverTimer.current = setTimeout(() => {
      cancelHover();
      const at = pointerAt.current;
      // A previous width animation may have moved this target away. Never chase it.
      const underPointer = at && document.elementFromPoint(at.x, at.y)?.closest("[data-ebg-item]");
      if (underPointer === button) setIntent(id);
    }, hoverDelay);
  };

  const onPointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return;
    pointerAt.current = null;
    pointerOver.current = null;
    cancelHover();
    hoverTimer.current = setTimeout(() => {
      cancelHover();
      setIntent(doneRef.current ?? keyFocus.current);
    }, leaveDelay);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const list = Array.from(
      root.current?.querySelectorAll<HTMLButtonElement>("[data-ebg-item]") ?? [],
    );
    const index = list.findIndex((button) => button === document.activeElement);
    if (index < 0) return;
    const last = list.length - 1;
    const target =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    if (target < 0) return;
    event.preventDefault();
    list[target]!.focus();
  };

  const m = metrics[size];
  const vars = {
    "--ebg-h": `${m.height}px`,
    "--ebg-icon": `${m.icon}px`,
    "--ebg-start": `${m.start}px`,
    "--ebg-gap": `${m.gap}px`,
    "--ebg-end": `${m.end}px`,
    ...style,
  } as CSSProperties;

  return (
    <div
      ref={root}
      role="toolbar"
      data-fit={fit || undefined}
      data-full-width={fullWidth || undefined}
      aria-label={label}
      aria-orientation="horizontal"
      data-chrome={chrome}
      className={[styles.group, styles[size], className].filter(Boolean).join(" ")}
      style={vars}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onPointerDownCapture={(event) => {
        if (event.pointerType !== "touch" || busy) return;
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-ebg-item]");
        const item = items.find((candidate) => candidate.id === target?.dataset.id);
        if (item?.disabled) setIntent(item.id);
      }}
    >
      {items.map((item) => (
        <Item
          key={item.id}
          item={busy && busy !== item.id ? { ...item, disabled: true } : item}
          size={size}
          expanded={expandedId === item.id}
          done={done?.id === item.id}
          busy={busy === item.id}
          tabStop={tabStop === item.id}
          onPointerDown={onItemPointerDown}
          onClick={onItemClick}
          onFocus={onItemFocus}
        />
      ))}
      <span className={styles.srOnly} role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}

export default ExpandingButtonGroup;
