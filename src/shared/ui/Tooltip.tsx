import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { PopoverAlign, PopoverSide } from "../lib/popover";
import { Popover } from "./Popover";

/** Time the pointer rests on a control before its tooltip opens. */
const TOOLTIP_DELAY_MS = 450;
/** Moving between neighbouring controls inside this window opens the next tooltip at once. */
const TOOLTIP_WARM_MS = 250;
let lastClosedAt = 0;

export type TooltipContent = {
  /** Title line. Falsy (and no details) leaves the control without a tooltip. */
  label?: ReactNode;
  /** Muted lines under the title (project, branch, counts, ...). */
  details?: readonly ReactNode[];
  side?: PopoverSide;
  align?: PopoverAlign;
  /** Wider cap for long paths. Defaults to the compact hint width. */
  wide?: boolean;
};

export type TooltipTriggerProps = {
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
  onPointerDown: () => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
};

/**
 * The app's hover and keyboard-focus tooltip state: a passive `Popover` hint, so panels do
 * not fall back to the browser's native `title` bubble. Spread `trigger` on the control and
 * render `tooltip` next to it (it portals, and adds no wrapper box). Use this when the
 * control must stay a direct child of its host (`ActionHost`, tab strips); otherwise the
 * `Tooltip` component wraps it. Keep the control's own accessible name (`aria-label`) and
 * pass `title=""` to a shared `Button` so it does not add a native tooltip of its own.
 * Touch input never opens it.
 */
export function useTooltip({ label, details, side = "bottom", align, wide }: TooltipContent): {
  trigger: TooltipTriggerProps;
  tooltip: ReactNode;
} {
  const id = useId();
  const timer = useRef<number | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const lines = (details ?? []).filter((line) => line != null && line !== false && line !== "");
  const empty = !label && lines.length === 0;

  const clearTimer = () => {
    if (timer.current == null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
  };
  const opened = useRef(false);
  const hide = () => {
    clearTimer();
    if (opened.current) {
      opened.current = false;
      lastClosedAt = performance.now();
    }
    setAnchor(null);
  };
  useEffect(() => clearTimer, []);

  const open = (element: HTMLElement) => {
    opened.current = true;
    setAnchor(element);
  };
  const show = (host: HTMLElement, delay: number) => {
    if (empty || timer.current != null) return;
    // A `display: contents` wrapper has no box; the control inside is the anchor.
    const element =
      host.hasAttribute("data-tooltip-wrap") && host.firstElementChild instanceof HTMLElement
        ? host.firstElementChild
        : host;
    if (delay <= 0) open(element);
    else
      timer.current = window.setTimeout(() => {
        timer.current = null;
        open(element);
      }, delay);
  };

  return {
    trigger: {
      onPointerEnter: (event) => {
        if (event.pointerType === "touch") return;
        show(
          event.currentTarget,
          performance.now() - lastClosedAt < TOOLTIP_WARM_MS ? 0 : TOOLTIP_DELAY_MS,
        );
      },
      onPointerLeave: hide,
      onPointerDown: hide,
      onFocus: (event) => {
        if (event.target.matches(":focus-visible")) show(event.currentTarget, 0);
      },
      onBlur: hide,
      onKeyDown: (event) => {
        if (event.key === "Escape") hide();
      },
    },
    tooltip:
      anchor && !empty ? (
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
          {label ? (
            <div className="whitespace-pre-line font-medium leading-snug">{label}</div>
          ) : null}
          {lines.length > 0 ? (
            <div
              className={`flex flex-col gap-0.5 text-(--ui-text-secondary) ${label ? "mt-1" : ""}`}
            >
              {lines.map((line, index) => (
                <div key={index} className="leading-snug">
                  {line}
                </div>
              ))}
            </div>
          ) : null}
        </Popover>
      ) : null,
  };
}

/**
 * Wraps one control with the shared tooltip. The wrapper adds no box (`display: contents`)
 * and anchors to the control inside; controls that must stay a direct child of their host
 * use `useTooltip` instead.
 */
export function Tooltip({ children, ...content }: TooltipContent & { children: ReactNode }) {
  const { trigger, tooltip } = useTooltip(content);
  return (
    <>
      <span className="contents" data-tooltip-wrap="" {...trigger}>
        {children}
      </span>
      {tooltip}
    </>
  );
}
