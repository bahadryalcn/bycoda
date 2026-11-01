import {
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { LAYER } from "../lib/layers";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { Info, X } from "./icons";
import { OverlayMenuLayer } from "./overlay";
import { Progress } from "./Progress";

/** The corner a toast stacks in. One stack per corner; `bottom-end` is the default. */
export type ToastPlacement = "bottom-end" | "top-end" | "bottom-start" | "top-start";
export type ToastTone = "neutral" | "info" | "success" | "warning" | "danger";

/** Seven seconds, long enough to read a sentence and reach its action. */
export const TOAST_VISIBLE_MS = 7000;
const DEFAULT_INSET = 12;

/* ---------------------------------------------------------------------------------------------
 * Corner stacks
 *
 * Each corner is one fixed, body-level column at `LAYER.toast`. Every toast (a standard card or a
 * feature's own card through ToastSlot) portals into its corner, so the stack offsets itself by
 * layout: no height reporting and no `offset` arithmetic between siblings. The column is created
 * on first use and leaves the DOM when its last toast unmounts.
 * ------------------------------------------------------------------------------------------- */

type Corner = { node: HTMLDivElement; users: number };
const corners = new Map<ToastPlacement, Corner>();
const insets: Partial<Record<ToastPlacement, number>> = {};

function applyInset(placement: ToastPlacement, node: HTMLDivElement) {
  const inset = insets[placement] ?? DEFAULT_INSET;
  const top = placement.startsWith("top");
  // The column's own padding is the inset, so card shadows and focus rings are never clipped
  // by its scroll box. The padding is pointer-transparent like the rest of the column.
  node.style.paddingBlockStart = `${top ? inset : DEFAULT_INSET}px`;
  node.style.paddingBlockEnd = `${top ? DEFAULT_INSET : inset}px`;
}

function corner(placement: ToastPlacement): Corner {
  let entry = corners.get(placement);
  if (!entry) {
    const node = document.createElement("div");
    const top = placement.startsWith("top");
    const end = placement.endsWith("end");
    node.dataset.toastRegion = placement;
    node.setAttribute("aria-live", "polite");
    node.className = [
      "pointer-events-none fixed flex max-h-dvh flex-col gap-2 overflow-y-auto overscroll-contain px-3",
      top ? "top-0" : "bottom-0",
      end ? "end-0 items-end" : "start-0 items-start",
    ].join(" ");
    node.style.zIndex = String(LAYER.toast);
    applyInset(placement, node);
    entry = { node, users: 0 };
    corners.set(placement, entry);
  }
  return entry;
}

/** Joins the corner column for the lifetime of the caller; the column leaves with its last user. */
function useCorner(placement: ToastPlacement) {
  const entry = typeof document === "undefined" ? null : corner(placement);
  useLayoutEffect(() => {
    if (!entry) return;
    entry.users += 1;
    if (!entry.node.isConnected) document.body.append(entry.node);
    return () => {
      entry.users -= 1;
      if (entry.users <= 0) entry.node.remove();
    };
  }, [entry]);
  return entry?.node ?? null;
}

export type ToastSlotProps = {
  placement?: ToastPlacement;
  /**
   * Position in the stack: lower first (the top of a column). Equal values keep mount order.
   * Use it to keep a persistent panel (due reminders) above transient cards.
   */
  order?: number;
  children: ReactNode;
};

/**
 * Puts a feature's own card (a reminder panel, an approval request) into a corner stack. The
 * card owns its surface, roles and actions; the slot owns placement, offset and the layer.
 * Menus opened from inside open above the stack.
 */
export function ToastSlot({ placement = "bottom-end", order, children }: ToastSlotProps) {
  const node = useCorner(placement);
  if (!node) return null;
  return createPortal(
    <div
      data-toast-slot=""
      className="pointer-events-auto flex max-w-full min-w-0 flex-col"
      style={order === undefined ? undefined : { order }}
    >
      <OverlayMenuLayer.Provider value={LAYER.toastPopover}>{children}</OverlayMenuLayer.Provider>
    </div>,
    node,
  );
}

/* ---------------------------------------------------------------------------------------------
 * Auto-dismiss
 * ------------------------------------------------------------------------------------------- */

/**
 * Expires after `durationMs` of visible, unattended time: hover, focus inside and a hidden
 * document pause the timer and resume only the remaining time. `null` never expires.
 */
export function useAutoDismiss(
  surface: { current: HTMLElement | null },
  {
    durationMs,
    paused,
    onExpire,
    resetKey,
  }: {
    durationMs: number | null;
    /** An operation that cannot be interrupted; the notice waits. */
    paused?: boolean;
    onExpire: () => void;
    /** A new message restarts the timer; parent rerenders do not. */
    resetKey?: unknown;
  },
) {
  const expire = useRef(onExpire);
  expire.current = onExpire;
  useEffect(() => {
    const node = surface.current;
    if (!node || durationMs === null || paused) return;
    let remaining = durationMs;
    let started = 0;
    let timer: number | undefined;
    let hovered = node.matches(":hover");
    let focused = node.contains(document.activeElement);
    const pause = () => {
      if (timer === undefined) return;
      window.clearTimeout(timer);
      timer = undefined;
      remaining = Math.max(0, remaining - (Date.now() - started));
    };
    const resume = () => {
      if (timer !== undefined || hovered || focused || document.hidden) return;
      started = Date.now();
      timer = window.setTimeout(() => {
        timer = undefined;
        expire.current();
      }, remaining);
    };
    const enter = () => {
      hovered = true;
      pause();
    };
    const leave = () => {
      hovered = false;
      resume();
    };
    const focus = () => {
      focused = true;
      pause();
    };
    const blur = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && node.contains(event.relatedTarget)) return;
      focused = false;
      resume();
    };
    const visibility = () => {
      if (document.hidden) pause();
      else resume();
    };
    node.addEventListener("pointerenter", enter);
    node.addEventListener("pointerleave", leave);
    node.addEventListener("focusin", focus);
    node.addEventListener("focusout", blur);
    document.addEventListener("visibilitychange", visibility);
    resume();
    return () => {
      pause();
      node.removeEventListener("pointerenter", enter);
      node.removeEventListener("pointerleave", leave);
      node.removeEventListener("focusin", focus);
      node.removeEventListener("focusout", blur);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [surface, durationMs, paused, resetKey]);
}

/* ---------------------------------------------------------------------------------------------
 * The standard card
 * ------------------------------------------------------------------------------------------- */

export type ToastAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Shows progress and blocks a second activation; the caller owns the operation. */
  pending?: boolean;
};

export type ToastContentProps = {
  /** Primary text. With `title`, it is the body under the heading. */
  message?: ReactNode;
  title?: string;
  /** Tone drives the glyph and role (danger announces assertively); never colour alone. */
  tone?: ToastTone;
  /** Extra body, such as a list of rows. Rendered below the message. */
  children?: ReactNode;
  /** One secondary action (Undo, Retry, Open), under the message. */
  action?: ToastAction;
  /** Additional actions in the header row, such as "Update all". Use shared Button. */
  actions?: ReactNode;
  /** Determinate progress from 0 to 1, with an accessible label. */
  progress?: { value: number; label: string };
  /** Omit for a toast the owner removes itself (no dismiss control, no expiry). */
  onDismiss?: () => void;
  /** Disables the dismiss control (and pauses expiry) while an operation cannot be interrupted. */
  dismissDisabled?: boolean;
  /**
   * Auto-dismiss delay. `null` keeps the toast until dismissed. Danger toasts default to `null`
   * so a failure and its diagnostic are never lost to a timer.
   */
  durationMs?: number | null;
  width?: "md" | "lg";
  "aria-label"?: string;
};

const WIDTH = {
  md: "w-[min(340px,calc(100vw-24px))]",
  lg: "w-[min(360px,calc(100vw-24px))]",
} as const;

/**
 * Calm tones sit on the opaque floating surface with the pane border; the attention tones
 * (warning, danger) keep Alert's own tone border and subtle tone surface.
 */
const FLOATING = {
  "--alert-border": "var(--ui-pane-border)",
  "--alert-surface": "var(--ui-surface-floating)",
} as CSSProperties;
const CALM: Record<ToastTone, boolean> = {
  neutral: true,
  info: true,
  success: true,
  warning: false,
  danger: false,
};

/**
 * The toast card without placement: floating surface, tone glyph, title, message,
 * actions, progress and dismiss, with auto-dismiss that pauses on hover and focus.
 * `Toast` places it in a corner stack; TransientNotice positions it itself.
 */
export function ToastCard({
  message,
  title,
  tone = "info",
  children,
  action,
  actions,
  progress,
  onDismiss,
  dismissDisabled,
  durationMs: durationOption,
  width = "md",
  position = "relative",
  className,
  style,
  frameRef,
  "aria-label": ariaLabel,
}: ToastContentProps & {
  /** `relative` in a stack; a self-positioned notice passes `fixed` or `absolute`. */
  position?: "relative" | "fixed" | "absolute";
  className?: string;
  style?: CSSProperties;
  frameRef?: Ref<HTMLDivElement>;
}) {
  const t = useT();
  const durationMs =
    durationOption === undefined
      ? tone === "danger" || !onDismiss
        ? null
        : TOAST_VISIBLE_MS
      : durationOption;
  const surface = useRef<HTMLDivElement>(null);
  useAutoDismiss(surface, {
    durationMs: onDismiss ? durationMs : null,
    paused: dismissDisabled,
    onExpire: () => onDismiss?.(),
    resetKey: `${title ?? ""}\n${typeof message === "string" ? message : ""}`,
  });
  const actionButton = action ? (
    <Button
      variant="secondary"
      size="sm"
      disabled={action.disabled}
      loading={action.pending}
      onClick={action.onClick}
    >
      {action.label}
    </Button>
  ) : null;
  // The Alert is the card itself: role, name, glyph and type on one element, so the
  // announced region and the hover/focus timer surface are the visible frame.
  return (
    <Alert
      ref={(node) => {
        surface.current = node;
        if (typeof frameRef === "function") frameRef(node);
        else if (frameRef) frameRef.current = node;
      }}
      tone={tone === "neutral" ? "info" : tone}
      icon={
        tone === "neutral" ? (
          <Info width={18} height={18} className="text-(--ui-text-secondary)" aria-hidden />
        ) : undefined
      }
      aria-label={ariaLabel}
      data-toast-tone={tone}
      style={{ ...(CALM[tone] ? FLOATING : null), ...style }}
      className={[
        position,
        "rounded-(--ui-radius-popup) shadow-(--ui-elevation-floating)",
        WIDTH[width],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1 select-text self-center break-words">
            {title ? <strong className="text-ui-secondary font-medium">{title}</strong> : message}
          </div>
          {onDismiss ? (
            <Button
              type="button"
              variant="ghost"
              iconOnly
              label={t("Dismiss notice")}
              tooltip={t("Dismiss notice")}
              disabled={dismissDisabled}
              onClick={onDismiss}
            >
              <X className="icon-sm" aria-hidden />
            </Button>
          ) : null}
        </div>
        {actions ? (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {actions}
            {actionButton}
          </div>
        ) : null}
        {children || progress || (title && message) ? (
          <div className="min-w-0 select-text break-words">
            {title ? message : null}
            {children}
            {progress ? (
              <Progress compact value={progress.value * 100} max={100} label={progress.label} />
            ) : null}
          </div>
        ) : null}
        {!actions && actionButton ? (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {actionButton}
          </div>
        ) : null}
      </div>
    </Alert>
  );
}

export type ToastProps = ToastContentProps & {
  placement?: ToastPlacement;
  /** See {@link ToastSlotProps.order}. */
  order?: number;
};

/**
 * A declarative toast owned by a component: it shows while rendered and stacks in its corner.
 *
 * ```tsx
 * {saved ? <Toast tone="success" message={t("Saved")} onDismiss={() => setSaved(false)} /> : null}
 * ```
 */
export function Toast({ placement = "bottom-end", order, ...props }: ToastProps) {
  return (
    <ToastSlot placement={placement} order={order}>
      <ToastCard {...props} />
    </ToastSlot>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Imperative queue: useToast() / toast
 * ------------------------------------------------------------------------------------------- */

export type ToastOptions = Omit<ToastContentProps, "onDismiss"> & {
  /** Reusing an id replaces that toast in place (a retry updates its own failure). */
  id?: string;
  placement?: ToastPlacement;
  order?: number;
  /** `false` hides the dismiss control; the toast then never expires and needs `dismiss(id)`. */
  dismissible?: boolean;
  /** Runs once when the toast leaves, by expiry, the dismiss control or `dismiss(id)`. */
  onDismiss?: () => void;
};

type Entry = ToastOptions & { id: string };
let queue: readonly Entry[] = [];
const listeners = new Set<() => void>();
let counter = 0;

function publish(next: readonly Entry[]) {
  queue = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function show(options: ToastOptions): string {
  const id = options.id ?? `toast-${++counter}`;
  const entry = { ...options, id };
  const index = queue.findIndex((item) => item.id === id);
  publish(index < 0 ? [...queue, entry] : queue.map((item, i) => (i === index ? entry : item)));
  return id;
}

function update(id: string, patch: Partial<ToastOptions>) {
  if (!queue.some((item) => item.id === id)) return;
  publish(queue.map((item) => (item.id === id ? { ...item, ...patch, id } : item)));
}

function dismiss(id: string) {
  const entry = queue.find((item) => item.id === id);
  if (!entry) return;
  publish(queue.filter((item) => item.id !== id));
  entry.onDismiss?.();
}

function dismissAll(placement?: ToastPlacement) {
  const leaving = queue.filter(
    (item) => !placement || (item.placement ?? "bottom-end") === placement,
  );
  publish(queue.filter((item) => !leaving.includes(item)));
  for (const item of leaving) item.onDismiss?.();
}

/**
 * Imperative toasts for code that has no component to own one (a background result). Shown by
 * the mounted `<ToastRegion />`; component-owned notices render `<Toast>` instead.
 */
export const toast = { show, update, dismiss, dismissAll } as const;

/** `show(options)` returns the id; `update(id, patch)`; `dismiss(id)`; `dismissAll(placement?)`. */
export function useToast() {
  return toast;
}

export type ToastRegionProps = {
  /**
   * Distance from the window edge per corner, in px (default 12). Top corners use it to clear
   * the title bar; bottom corners to clear the status bar.
   */
  insets?: Partial<Record<ToastPlacement, number>>;
};

/**
 * Mount once per window (the workspace layout). Renders the imperative `toast` queue and sets
 * the corner insets. Component-owned `<Toast>` and `<ToastSlot>` stack in the same corners
 * whether or not the region is mounted.
 */
export function ToastRegion({ insets: next }: ToastRegionProps) {
  const entries = useSyncExternalStore(
    subscribe,
    () => queue,
    () => queue,
  );
  const key = JSON.stringify(next ?? {});
  useLayoutEffect(() => {
    const parsed = JSON.parse(key) as Partial<Record<ToastPlacement, number>>;
    for (const placement of ["bottom-end", "top-end", "bottom-start", "top-start"] as const) {
      if (parsed[placement] === undefined) delete insets[placement];
      else insets[placement] = parsed[placement];
      const entry = corners.get(placement);
      if (entry) applyInset(placement, entry.node);
    }
  }, [key]);
  return (
    <>
      {entries.map(
        ({ id, placement, order, dismissible = true, onDismiss: _onDismiss, ...props }) => (
          <Toast
            key={id}
            {...props}
            placement={placement}
            order={order}
            onDismiss={dismissible ? () => dismiss(id) : undefined}
          />
        ),
      )}
    </>
  );
}
