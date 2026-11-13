import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type ReactElement,
  type SyntheticEvent,
} from "react";
import type { PopoverAlign, PopoverSide } from "../lib/popover";
import { Popover } from "./Popover";
import { ShortcutKeys } from "./ShortcutKbd";
import { useT } from "../i18n";
import { formatShortcutLabelWith, usePlatform } from "./shortcut";
import { needsOverflowTooltip } from "./tooltipVisibility";

/** Time the pointer rests on a control before its tooltip opens. */
export const TOOLTIP_DELAY_MS = 450;
/** Moving between neighbouring controls inside this window opens the next hint at once. */
export const TOOLTIP_WARM_MS = 250;
/** Hover cards open a little sooner than hints: the pointer rests on an object, not a control. */
export const HOVER_CARD_OPEN_MS = 300;
/** Grace period that lets the pointer cross the gap from the trigger into a hover card. */
export const HOVER_CARD_CLOSE_MS = 150;

/** Last close per hint family, for the warm handoff between neighbouring triggers. */
const lastClosedAt: Record<string, number> = {};

export type HoverIntentOptions = {
  /** Hint family that shares one warm handoff window (`tooltip`, `hover-card`). */
  group?: string;
  /** Rest time before opening from a pointer. Default {@link TOOLTIP_DELAY_MS}. */
  openDelay?: number;
  /** Delay before a pointer leave closes. Default 0 (close at once). */
  closeDelay?: number;
  /** Inside this window after another hint of the group closed, opening is immediate. */
  warmMs?: number;
};

/**
 * Shared hover-intent timing for tooltips and hover cards: one pending timer, a delayed open,
 * an optional delayed close and a warm handoff, so moving along a toolbar opens the next hint
 * at once. Mounts nothing; `anchor` is set only while open.
 */
export function useHoverIntent({
  group = "tooltip",
  openDelay = TOOLTIP_DELAY_MS,
  closeDelay = 0,
  warmMs = TOOLTIP_WARM_MS,
}: HoverIntentOptions = {}) {
  const timer = useRef<{ id: number; kind: "open" | "close" } | null>(null);
  const opened = useRef<HTMLElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const cancel = () => {
    if (!timer.current) return;
    window.clearTimeout(timer.current.id);
    timer.current = null;
  };
  // Named `handle*`: these only run from pointer events and timers, never during render.
  const handleClose = () => {
    cancel();
    if (opened.current) {
      opened.current = null;
      lastClosedAt[group] = performance.now();
    }
    setAnchor(null);
  };
  useEffect(() => cancel, []);

  const show = (element: HTMLElement) => {
    cancel();
    opened.current = element;
    setAnchor(element);
  };
  const handleWarm = () => performance.now() - (lastClosedAt[group] ?? -Infinity) < warmMs;
  /** Opens after the rest delay (or at once when warm or `delay` is 0). */
  const scheduleOpen = (element: HTMLElement, delay = handleWarm() ? 0 : openDelay) => {
    if (timer.current?.kind === "close") cancel();
    if (opened.current === element) return;
    if (timer.current?.kind === "open") return;
    if (delay <= 0) {
      show(element);
      return;
    }
    const id = window.setTimeout(() => {
      timer.current = null;
      show(element);
    }, delay);
    timer.current = { id, kind: "open" };
  };
  /** Closes after the close delay; a pointer coming back (or into a card) cancels it. */
  const scheduleClose = (delay = closeDelay) => {
    if (!opened.current || delay <= 0) {
      handleClose();
      return;
    }
    if (timer.current?.kind === "close") return;
    cancel();
    const id = window.setTimeout(() => {
      timer.current = null;
      handleClose();
    }, delay);
    timer.current = { id, kind: "close" };
  };
  return { anchor, scheduleOpen, scheduleClose, close: handleClose, cancel };
}

/** A `display: contents` wrapper has no box; the control inside is the anchor. */
export function tooltipAnchor(host: HTMLElement): HTMLElement {
  return host.hasAttribute("data-tooltip-wrap") && host.firstElementChild instanceof HTMLElement
    ? host.firstElementChild
    : host;
}

export type TooltipContent = {
  /** `overflow` reveals clipped/hidden labels or missing shortcuts, never a fully visible copy.
   * Additional detail lines remain available. Layout is measured only on interaction. */
  when?: "always" | "overflow";
  /** Explicit title line. Omit it when the control already shows the label.
   * Falsy (and no details or shortcut) leaves the control without a tooltip. */
  label?: ReactNode;
  /** Muted lines under the title (project, branch, counts, a disabled reason...). */
  details?: readonly ReactNode[];
  /** Display-only key hint shown as key caps after the title (`Mod+K`, `Ctrl+Shift+P`, `Esc`). */
  shortcut?: string | null;
  side?: PopoverSide;
  align?: PopoverAlign;
  /** Wider cap for long paths. Defaults to the compact hint width. */
  wide?: boolean;
  /** Pointer rest time in ms. Default {@link TOOLTIP_DELAY_MS}; keyboard focus is always immediate. */
  delay?: number;
  /**
   * Links the open tooltip to its anchor with `aria-describedby` (default true). Owners that
   * set `aria-describedby` through props themselves (Button) pass false and use `id`/`open`.
   * The link is skipped when the tooltip only repeats the anchor's `aria-label`.
   */
  describe?: boolean;
};

export type TooltipTriggerProps = {
  "data-tooltip-owner"?: string;
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
  onPointerDown: () => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
};

const presentLines = (details: readonly ReactNode[] | undefined) =>
  (details ?? []).filter((line) => line != null && line !== false && line !== "");

/** The one tooltip body: title (with optional key caps) and muted detail lines. */
function TooltipBody({
  label,
  lines,
  shortcut,
}: {
  label?: ReactNode;
  lines: readonly ReactNode[];
  shortcut?: string | null;
}) {
  return (
    <>
      {label || shortcut ? (
        <div className="flex items-center gap-2">
          {label ? (
            <div className="min-w-0 whitespace-pre-line font-medium leading-snug">{label}</div>
          ) : null}
          {shortcut ? <ShortcutKeys shortcut={shortcut} size="xs" className="ms-auto" /> : null}
        </div>
      ) : null}
      {lines.length > 0 ? (
        <div
          className={`flex flex-col gap-0.5 text-(--ui-text-secondary) ${label || shortcut ? "mt-1" : ""}`}
        >
          {lines.map((line, index) => (
            <div key={index} className="leading-snug">
              {line}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

/**
 * The app's hover and keyboard-focus tooltip: a passive `Popover` hint, so panels do not fall
 * back to the browser's native `title` bubble. Spread `trigger` on the control and render
 * `tooltip` next to it (it portals, and adds no wrapper box). Use this when the control must
 * stay a direct child of its host (`ActionHost`, tab strips); otherwise the `Tooltip` component
 * wraps it. A shared `Button` already routes `tooltip`, `title`, `shortcut` and its icon-only
 * `label` through this hook; pass `title=""` to a Button that a `Tooltip` wraps so it does not
 * add a second hint.
 *
 * Pointer hover opens after `delay` (450 ms; at once within 250 ms of another hint closing);
 * keyboard focus (`:focus-visible`) opens at once; leave, press, blur and Escape close. Touch
 * never opens it. Disabled anchors still open on hover (pointer events reach disabled controls;
 * nothing here relies on mouse events or on the anchor's own click handling); keyboard users
 * reach a disabled reason only on a focusable `aria-disabled` control, such as a Button with
 * `disabledReason`. Nothing mounts until the hint opens.
 */
export function useTooltip({
  when = "always",
  label,
  details,
  shortcut,
  side = "bottom",
  align,
  wide,
  delay = TOOLTIP_DELAY_MS,
  describe = true,
}: TooltipContent): {
  trigger: TooltipTriggerProps;
  tooltip: ReactNode;
  /** The tooltip element id, for an owner-managed `aria-describedby`. */
  id: string;
  /** The tooltip is showing. */
  open: boolean;
  /** Closes the tooltip now (for example when the control activates). */
  hide: () => void;
} {
  const id = useId();
  const platform = usePlatform();
  const t = useT();
  const [, refresh] = useState(0);
  const intent = useHoverIntent({ openDelay: delay });
  const lines = presentLines(details);
  const empty = !label && !shortcut && lines.length === 0;
  const anchor = intent.anchor;
  const formatted = shortcut ? formatShortcutLabelWith(shortcut, platform, t) : null;
  const shortcutInfo =
    shortcut && formatted
      ? {
          raw: shortcut,
          spoken: formatted.spoken,
          keys: formatted.alternatives
            .map((sequence) =>
              sequence.map((chord) => chord.map((key) => key.label).join("")).join(" "),
            )
            .join(" / "),
        }
      : undefined;
  const eligible = (element: HTMLElement) => {
    // A containing control already owns full-value recovery and its extra context.
    if (when === "overflow" && element.parentElement?.closest("[data-tooltip-owner]")) return false;
    if (when === "overflow") return lines.length > 0 || needsOverflowTooltip(element, shortcutInfo);
    return true;
  };
  const open = !!anchor && !empty && eligible(anchor);
  const hide = intent.close;

  // Recheck an active hint as its pane, text or responsive mode changes. No idle row observers.
  useEffect(() => {
    if (!anchor || when !== "overflow") return;
    const update = () => refresh((value) => value + 1);
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    anchor.querySelectorAll<HTMLElement>("*").forEach((element) => observer.observe(element));
    const mutations = new MutationObserver(update);
    mutations.observe(anchor, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      // No "style": motion writes inline styles on each render; observing them looped
      // overflow anchors (motion writes -> refresh -> render) under act().
      attributeFilter: ["class", "hidden"],
    });
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [anchor, when]);

  // Imperative link for wrapped controls whose props this hook does not own.
  const plainLabel = typeof label === "string" ? label : undefined;
  const redundant = !shortcut && lines.length === 0 && plainLabel != null;
  useLayoutEffect(() => {
    if (!describe || !open || !anchor) return;
    if (redundant && anchor.getAttribute("aria-label") === plainLabel) return;
    const current = anchor.getAttribute("aria-describedby");
    const tokens = current ? current.split(/\s+/) : [];
    if (tokens.includes(id)) return;
    anchor.setAttribute("aria-describedby", [...tokens, id].join(" "));
    return () => {
      const remaining = (anchor.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .filter((token) => token && token !== id);
      if (remaining.length) anchor.setAttribute("aria-describedby", remaining.join(" "));
      else anchor.removeAttribute("aria-describedby");
    };
  }, [describe, open, anchor, id, redundant, plainLabel]);

  return {
    id,
    open,
    hide,
    trigger: {
      "data-tooltip-owner": empty ? undefined : "",
      onPointerEnter: (event) => {
        if (
          event.pointerType === "touch" ||
          empty ||
          !event.currentTarget.contains(event.target as Node)
        )
          return;
        const target = tooltipAnchor(event.currentTarget);
        if (eligible(target)) intent.scheduleOpen(target);
      },
      onPointerLeave: hide,
      onPointerDown: hide,
      onFocus: (event) => {
        if (empty || !event.currentTarget.contains(event.target as Node)) return;
        const target = tooltipAnchor(event.currentTarget);
        if (event.target.matches(":focus-visible") && eligible(target))
          intent.scheduleOpen(target, 0);
      },
      onBlur: hide,
      onKeyDown: (event) => {
        if (event.key === "Escape") hide();
      },
    },
    tooltip: open ? (
      <Popover
        anchor={anchor}
        role="tooltip"
        id={id}
        side={side}
        align={align}
        restoreFocus={false}
        passive
        motion="none"
        onDismiss={hide}
        className={`pointer-events-none break-words p-2 text-(length:--ui-font-caption) text-content ${
          wide ? "max-w-80" : "max-w-60"
        }`}
      >
        <TooltipBody label={label} lines={lines} shortcut={shortcut} />
      </Popover>
    ) : null,
  };
}

/**
 * Wraps one control with the shared tooltip. The wrapper adds no box (`display: contents`)
 * and anchors to the control inside; controls that must stay a direct child of their host
 * use `useTooltip` instead. A wrapped shared `Button` takes `title=""` so it adds no hint of
 * its own; prefer the Button's own `tooltip`/`tooltipDetails`/`shortcut` props over wrapping.
 * Opens after a pointer delay or at once on keyboard focus, never on touch; add `shortcut` or `details` lines.
 * Native title tooltip attributes and hand-written plain hover hints; iframe and SVG accessible titles retain their naming job.
 * @group overlay
 * @use Add what the visible label lacks: a shortcut, detail, or the reason a control is disabled.
 * @avoid Repeating a visible label; essential info only in a hover hint; interactive preview: useHoverCard. Clipped text: OverflowTooltip.
 */
export function Tooltip({
  children,
  asChild = false,
  ...content
}: TooltipContent & { children: ReactNode; asChild?: boolean }) {
  const { trigger, tooltip } = useTooltip(content);
  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<Record<string, unknown>>;
    const merged: Record<string, unknown> = {
      "data-tooltip-owner": trigger["data-tooltip-owner"],
    };
    for (const [name, handler] of Object.entries(trigger)) {
      if (typeof handler !== "function") continue;
      merged[name] = (event: SyntheticEvent<HTMLElement>) => {
        const original = child.props[name] as
          | ((event: SyntheticEvent<HTMLElement>) => void)
          | undefined;
        original?.(event);
        if (
          !event.defaultPrevented ||
          name === "onKeyDown" ||
          name === "onBlur" ||
          name === "onPointerLeave"
        )
          (handler as (event: SyntheticEvent<HTMLElement>) => void)(event);
      };
    }
    return (
      <>
        {cloneElement(child, merged)}
        {tooltip}
      </>
    );
  }
  return (
    <>
      <span className="contents" data-tooltip-wrap="" {...trigger}>
        {children}
      </span>
      {tooltip}
    </>
  );
}

/**
 * Tooltip that appears only while its single child's text is clipped, showing the full text; no native title,
 * no layout box.
 * @group overlay
 * @use Recover truncated or hidden text (file names, titles in narrow rows).
 * @avoid Text that is always fully visible. Middle-truncated names: MiddleTruncate. Extra detail or shortcuts: Tooltip.
 */
export function OverflowTooltip(props: TooltipContent & { children: ReactNode }) {
  return <Tooltip {...props} when="overflow" asChild />;
}
