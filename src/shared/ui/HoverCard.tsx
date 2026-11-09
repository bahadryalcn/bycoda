import {
  useEffect,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { PopoverAlign, PopoverSide } from "../lib/popover";
import { Popover } from "./Popover";
import {
  HOVER_CARD_CLOSE_MS,
  HOVER_CARD_OPEN_MS,
  TOOLTIP_WARM_MS,
  tooltipAnchor,
  useHoverIntent,
} from "./Tooltip";

export type HoverCardOptions = {
  side?: PopoverSide;
  align?: PopoverAlign;
  /** Card width in px. Defaults to the content's own width. */
  width?: number;
  /** Pointer rest time before opening. Default {@link HOVER_CARD_OPEN_MS} (300 ms). */
  openDelay?: number;
  /** Grace period after the pointer leaves the trigger or card. Default {@link HOVER_CARD_CLOSE_MS} (150 ms). */
  closeDelay?: number;
  /** Never open (for example while the trigger is being dragged or renamed). */
  disabled?: boolean;
  /** Fires when the card opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /** Classes for the card content. Default `max-w-80 p-3`. */
  className?: string;
  /** Accessible name for the card surface. */
  "aria-label"?: string;
};

export type HoverCardTriggerProps = {
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: (event: FocusEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
};

/**
 * Hover-intent state for a rich, interactive preview card. Spread `trigger` on the object
 * (row, chip, avatar) and render `card(content)` next to it; it portals and adds no box.
 * Use the `HoverCard` component to wrap a single trigger instead.
 *
 * - Opens after the pointer rests 300 ms (at once within 250 ms of another card closing),
 *   or at once on keyboard focus (`:focus-visible`). Touch never opens it.
 * - The pointer can cross into the card: leaving the trigger or the card closes after
 *   150 ms, and entering either again cancels the close. Focus inside the card keeps it open.
 * - Escape closes it (and returns focus to the trigger when focus was inside the card);
 *   a press outside closes it.
 * - The content mounts only while open.
 *
 * A hover card is optional enrichment: everything in it must also be reachable through a
 * focus/tap route (the row's own action, menu or detail view). Never hide required actions
 * only inside hover.
 */
export function useHoverCard({
  side = "bottom",
  align = "start",
  width,
  openDelay = HOVER_CARD_OPEN_MS,
  closeDelay = HOVER_CARD_CLOSE_MS,
  disabled = false,
  onOpenChange,
  className = "max-w-80 p-3",
  "aria-label": ariaLabel,
}: HoverCardOptions = {}) {
  const intent = useHoverIntent({
    group: "hover-card",
    openDelay,
    closeDelay,
    warmMs: TOOLTIP_WARM_MS,
  });
  const surface = useRef<HTMLDivElement | null>(null);
  const anchor = intent.anchor;
  const open = !!anchor && !disabled;

  const changed = useRef(onOpenChange);
  changed.current = onOpenChange;
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current === open) return;
    wasOpen.current = open;
    changed.current?.(open);
  }, [open]);

  const inside = (node: EventTarget | null) =>
    node instanceof Node && (!!surface.current?.contains(node) || !!anchor?.contains(node));
  const closeAndReturn = () => {
    const focusInside = !!surface.current?.contains(document.activeElement);
    const trigger = anchor;
    intent.close();
    if (focusInside && trigger?.isConnected) trigger.focus({ preventScroll: true });
  };

  const trigger: HoverCardTriggerProps = {
    onPointerEnter: (event) => {
      if (disabled || event.pointerType === "touch") return;
      intent.scheduleOpen(tooltipAnchor(event.currentTarget));
    },
    onPointerLeave: () => intent.scheduleClose(),
    onFocus: (event) => {
      if (disabled || !event.target.matches(":focus-visible")) return;
      intent.scheduleOpen(tooltipAnchor(event.currentTarget), 0);
    },
    onBlur: (event) => {
      if (!inside(event.relatedTarget)) intent.scheduleClose();
    },
    onKeyDown: (event) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        intent.close();
      }
    },
  };

  const card = (content: ReactNode | (() => ReactNode)) =>
    open ? (
      <Popover
        ref={surface}
        anchor={anchor}
        side={side}
        align={align}
        width={width}
        restoreFocus={false}
        aria-label={ariaLabel}
        data-hover-card=""
        onDismiss={(reason) => (reason === "escape" ? closeAndReturn() : intent.close())}
        onPointerEnter={() => intent.cancel()}
        onPointerLeave={() => intent.scheduleClose()}
        onFocus={() => intent.cancel()}
        onBlur={(event) => {
          if (!inside(event.relatedTarget)) intent.scheduleClose();
        }}
        className={className}
      >
        {typeof content === "function" ? content() : content}
      </Popover>
    ) : null;

  return { trigger, open, close: intent.close, card };
}

export type HoverCardProps = HoverCardOptions & {
  /** The card body. A function renders only while the card is open. */
  content: ReactNode | (() => ReactNode);
  /** One trigger element. The wrapper adds no box (`display: contents`). */
  children: ReactNode;
};

/**
 * Wraps one trigger with a rich, interactive preview card on hover or keyboard focus: opens after 300 ms rest,
 * the pointer can cross into the card, Escape closes, content mounts only while open. Adds no box.
 * Use `useHoverCard` when the trigger must stay a direct child.
 * @group overlay
 * @use An optional preview of an object (row, chip, avatar) with links or actions. Everything in it needs a focus or tap route too.
 * @avoid Plain text hint on a control: Tooltip. Help behind an icon: InfoPopover. Click-opened panel or menu: Popover or DropdownMenu. Required actions or state never live only in a hover card.
 */
export function HoverCard({ content, children, ...options }: HoverCardProps) {
  const { trigger, card } = useHoverCard(options);
  return (
    <>
      <span className="contents" data-tooltip-wrap="" {...trigger}>
        {children}
      </span>
      {card(content)}
    </>
  );
}
