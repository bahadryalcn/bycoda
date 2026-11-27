import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../lib/layers";
import { observeResize } from "../lib/observeResize";
import {
  layoutStack,
  TOAST_STACK_VISIBLE,
  ToastStackItem,
  toastStackClassName,
  type ToastStackTarget,
} from "./arc/toast-stack/toast-stack";
import { OverlayMenuLayer } from "./overlay";
import { ToastCard, type ToastContentProps, type ToastTone } from "./ToastCard";

/**
 * Toast card re-export for consumers of the shared toast queue.
 * @group feedback
 * @use Render toast content through Toast or the `toast` queue.
 * @avoid Placement and expiry queue: Toast. Inline feedback: InlineMessage.
 * @status internal
 */
export {
  ToastCard,
  TOAST_VISIBLE_MS,
  useAutoDismiss,
  type ToastAction,
  type ToastContentProps,
  type ToastTone,
} from "./ToastCard";

/**
 * Where a toast stacks. Routine messages use top-end; warnings and errors use top-center.
 */
export type ToastPlacement = "top-center" | "bottom-end" | "top-end" | "bottom-start" | "top-start";

/** Routine feedback stays beside the work, under the title bar. */
export const DEFAULT_TOAST_PLACEMENT: ToastPlacement = "top-end";
const defaultPlacement = (tone: ToastTone): ToastPlacement =>
  tone === "warning" || tone === "danger" ? "top-center" : DEFAULT_TOAST_PLACEMENT;

export type ToastAnnouncement = {
  id: string;
  title: string;
  message: string;
  tone: ToastTone;
  occurredAt: number;
  /** The toast asked to stay until dismissed (`durationMs={null}`). */
  persist?: boolean;
  /** The toast carries an action, so it is worth keeping after it leaves. */
  hasAction?: boolean;
};
const announcementListeners = new Set<(entry: ToastAnnouncement) => void>();
const PLACEMENTS: readonly ToastPlacement[] = [
  "top-center",
  "bottom-end",
  "top-end",
  "bottom-start",
  "top-start",
];

const DEFAULT_INSET = 12;
/**
 * How far each corner column reaches past the window edge. A scroll box clips at its own padding
 * edge, and the floating shadow reaches 8px below and 24px of blur past a toast. The column bleeds
 * this far and its padding gives the toasts back their inset, so layout is unchanged and no shadow
 * is cut off.
 */
const SHADOW_BLEED = 32;
/** Keeps the toast stack on the inner side of every feature card in its corner. */
const STACK_ORDER = 1000;

/* ---------------------------------------------------------------------------------------------
 * Corner stacks
 *
 * Each corner is one fixed, body-level column at `LAYER.toast`. It holds the corner's toast stack
 * and, nearer the window edge, the feature cards placed through ToastSlot. Toasts portal into the
 * stack: the newest sits in front, older ones tuck behind it, and hovering or focusing the stack
 * fans it out and holds every toast's expiry. The column is created on first use and leaves the
 * DOM when its last toast unmounts.
 * ------------------------------------------------------------------------------------------- */

type Pile = {
  /** Toast keys from the front (newest) back. */
  keys: readonly number[];
  targets: readonly ToastStackTarget[];
  expanded: boolean;
};
const EMPTY_PILE: Pile = { keys: [], targets: [], expanded: false };

type Corner = {
  node: HTMLDivElement;
  stack: HTMLDivElement;
  top: boolean;
  users: number;
  keys: number[];
  heights: Map<number, number>;
  hovered: boolean;
  focused: boolean;
  tapped: boolean;
  pile: Pile;
  listeners: Set<() => void>;
  subscribe: (listener: () => void) => () => void;
  stopResize?: () => void;
};
const corners = new Map<ToastPlacement, Corner>();
const insets: Partial<Record<ToastPlacement, number>> = {};
let toastSeq = 0;
/** Keys count up, so a newer toast sorts and stacks above an older one. */
const nextToastKey = () => (toastSeq += 1);

/** Fixes where a corner column sits and how far its scroll box reaches past the window edge. */
function placeColumn(placement: ToastPlacement, node: HTMLDivElement) {
  const top = placement.startsWith("top");
  const end = placement.endsWith("end");
  const center = placement.endsWith("center");
  node.style.top = top ? `-${SHADOW_BLEED}px` : "";
  node.style.bottom = top ? "" : `-${SHADOW_BLEED}px`;
  node.style.insetInlineStart = center || !end ? `-${SHADOW_BLEED}px` : "";
  node.style.insetInlineEnd = center || end ? `-${SHADOW_BLEED}px` : "";
  node.style.maxHeight = `calc(100dvh + ${2 * SHADOW_BLEED}px)`;
  node.style.paddingInline = `${DEFAULT_INSET + SHADOW_BLEED}px`;
  applyInset(placement, node);
}

function applyInset(placement: ToastPlacement, node: HTMLDivElement) {
  const inset = insets[placement] ?? DEFAULT_INSET;
  const top = placement.startsWith("top");
  // The padding is the toasts' inset from the window edge; the bleed past it is shadow room that
  // stays pointer-transparent like the rest of the column.
  node.style.paddingBlockStart = `${(top ? inset : DEFAULT_INSET) + SHADOW_BLEED}px`;
  node.style.paddingBlockEnd = `${(top ? DEFAULT_INSET : inset) + SHADOW_BLEED}px`;
}

/** On narrow windows, routine feedback sits below centered alerts instead of covering them. */
function syncTopCorners() {
  const routine = corners.get("top-end");
  if (!routine?.node.isConnected) return;
  const center = corners.get("top-center");
  const routineBox = routine.stack.getBoundingClientRect();
  let inset = insets["top-end"] ?? DEFAULT_INSET;
  if (center?.node.isConnected) {
    for (const child of center.node.children) {
      const box = child.getBoundingClientRect();
      if (box.height > 0 && box.left < routineBox.right && box.right > routineBox.left) {
        inset = Math.max(inset, box.bottom + DEFAULT_INSET);
      }
    }
  }
  const padding = `${inset + SHADOW_BLEED}px`;
  if (routine.node.style.paddingBlockStart !== padding)
    routine.node.style.paddingBlockStart = padding;
}

/** Recomputes where every toast of the corner sits and tells the toasts. */
function syncPile(entry: Corner) {
  // An emptied stack gets no leave or blur event, so nothing may keep it open.
  if (!entry.keys.length) entry.hovered = entry.focused = entry.tapped = false;
  const expanded = entry.keys.length > 0 && (entry.hovered || entry.focused || entry.tapped);
  const { targets, listHeight } = layoutStack(
    entry.keys.map((key) => entry.heights.get(key) ?? 0),
    expanded,
    entry.top ? "top" : "bottom",
  );
  entry.pile = { keys: [...entry.keys], targets, expanded };
  entry.stack.style.blockSize = `${listHeight}px`;
  entry.stack.toggleAttribute("data-empty", entry.keys.length === 0);
  syncTopCorners();
  for (const listener of entry.listeners) listener();
}

function setOpen(entry: Corner, flag: "hovered" | "focused" | "tapped", value: boolean) {
  if (entry[flag] === value) return;
  entry[flag] = value;
  syncPile(entry);
}

const focusVisible = (element: Element) => {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
};

/** Hover, keyboard focus or a tap opens the stack; leaving it closes it again. */
function watchStack(entry: Corner) {
  const { stack } = entry;
  const mouse = (open: boolean) => (event: PointerEvent) => {
    if (event.pointerType === "mouse") setOpen(entry, "hovered", open);
  };
  stack.addEventListener("pointerenter", mouse(true));
  stack.addEventListener("pointermove", mouse(true));
  stack.addEventListener("pointerleave", mouse(false));
  // Only keyboard focus opens the stack; a mouse click on a button should not pin it open.
  stack.addEventListener("focusin", (event) => {
    if (event.target instanceof Element && focusVisible(event.target))
      setOpen(entry, "focused", true);
  });
  stack.addEventListener("focusout", (event) => {
    if (!(event.relatedTarget instanceof Node) || !stack.contains(event.relatedTarget))
      setOpen(entry, "focused", false);
  });
  // Touch has no hover, so a tap on a card opens or closes the stack instead.
  stack.addEventListener("pointerup", (event) => {
    if (event.pointerType === "mouse") return;
    if (event.target instanceof Element && !event.target.closest("button, a"))
      setOpen(entry, "tapped", !entry.tapped);
  });
  document.addEventListener("pointerdown", (event) => {
    if (entry.tapped && !(event.target instanceof Node && stack.contains(event.target)))
      setOpen(entry, "tapped", false);
  });
}

function corner(placement: ToastPlacement): Corner {
  let entry = corners.get(placement);
  if (!entry) {
    const node = document.createElement("div");
    const top = placement.startsWith("top");
    const end = placement.endsWith("end");
    const center = placement.endsWith("center");
    node.dataset.toastRegion = placement;
    // No aria-live: each toast card announces itself through its own role (alert or status), so a
    // live column around it would announce every toast twice.
    // A bottom column grows upward: what leaves through the window edge then never scrolls it.
    node.className = [
      "pointer-events-none fixed flex gap-2 overflow-y-auto overscroll-contain",
      top ? "flex-col" : "flex-col-reverse",
      center ? "items-center" : end ? "items-end" : "items-start",
    ].join(" ");
    node.style.zIndex = String(LAYER.toast);
    placeColumn(placement, node);
    const stack = document.createElement("div");
    stack.dataset.toastStack = "";
    stack.dataset.empty = "";
    stack.className = toastStackClassName;
    stack.style.order = String(STACK_ORDER);
    node.append(stack);
    const listeners = new Set<() => void>();
    const created: Corner = {
      node,
      stack,
      top,
      users: 0,
      keys: [],
      heights: new Map(),
      hovered: false,
      focused: false,
      tapped: false,
      pile: EMPTY_PILE,
      listeners,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    watchStack(created);
    corners.set(placement, created);
    entry = created;
  }
  return entry;
}

function joinCorner(entry: Corner) {
  entry.users += 1;
  if (!entry.node.isConnected) document.body.append(entry.node);
  if (
    entry.users === 1 &&
    (entry === corners.get("top-center") || entry === corners.get("top-end"))
  ) {
    const stop = observeResize(entry.node, syncTopCorners);
    window.addEventListener("resize", syncTopCorners);
    entry.stopResize = () => {
      stop();
      window.removeEventListener("resize", syncTopCorners);
    };
  }
  syncTopCorners();
}

function leaveCorner(entry: Corner) {
  entry.users -= 1;
  if (entry.users <= 0) {
    entry.stopResize?.();
    entry.stopResize = undefined;
    entry.node.remove();
  }
  syncTopCorners();
}

/** Joins the corner column for the lifetime of the caller; the column leaves with its last user. */
function useCorner(placement: ToastPlacement) {
  const entry = typeof document === "undefined" ? null : corner(placement);
  useLayoutEffect(() => {
    if (!entry) return;
    joinCorner(entry);
    return () => leaveCorner(entry);
  }, [entry]);
  return entry;
}

function measureToast(entry: Corner, key: number, height: number) {
  if (entry.heights.get(key) === height) return;
  entry.heights.set(key, height);
  if (entry.keys.includes(key)) syncPile(entry);
}

const subscribeNothing = () => () => {};
const emptyPile = () => EMPTY_PILE;

/** Puts one toast card in its corner's stack: newest in front, older ones tucked behind. */
function StackedToast({ placement, children }: { placement: ToastPlacement; children: ReactNode }) {
  const entry = useCorner(placement);
  const [key] = useState(nextToastKey);
  const pile = useSyncExternalStore(
    entry ? entry.subscribe : subscribeNothing,
    entry ? () => entry.pile : emptyPile,
    emptyPile,
  );
  // The toast is in the stack for as long as it is mounted, in front of the ones before it.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- registers the toast with its corner stack, outside React, until unmount
  useLayoutEffect(() => {
    if (!entry) return;
    entry.keys.unshift(key);
    syncPile(entry);
    return () => {
      entry.keys.splice(entry.keys.indexOf(key), 1);
      entry.heights.delete(key);
      syncPile(entry);
      // Removing the focused toast fires no blur, so check where focus went once it is gone.
      queueMicrotask(() => {
        if (!entry.stack.contains(document.activeElement)) setOpen(entry, "focused", false);
      });
    };
  }, [entry, key]);
  if (!entry) return null;
  const index = pile.keys.indexOf(key);
  return createPortal(
    <ToastStackItem
      target={pile.targets[index] ?? null}
      expanded={pile.expanded}
      front={index === 0}
      hidden={index >= TOAST_STACK_VISIBLE}
      edge={entry.top ? "top" : "bottom"}
      zIndex={key}
      onMeasure={(height) => measureToast(entry, key, height)}
      retain={() => {
        joinCorner(entry);
        return () => leaveCorner(entry);
      }}
    >
      <OverlayMenuLayer.Provider value={LAYER.toastPopover}>{children}</OverlayMenuLayer.Provider>
    </ToastStackItem>,
    entry.stack,
  );
}

export type ToastSlotProps = {
  placement?: ToastPlacement;
  /**
   * Position among the corner's feature cards: lower sits higher on screen. Equal values keep
   * mount order. Use it to keep a persistent panel (due reminders) above other cards.
   */
  order?: number;
  children: ReactNode;
};

/**
 * Puts a feature's own card (a reminder panel, an approval request) into the alert stack column. The card owns
 * its surface, roles and actions; the slot owns placement, offset and the layer. Feature cards
 * stay fully visible next to the window edge and never tuck into the toast stack beside them.
 * Menus opened from inside open above the stack.
 * @group feedback
 * @use Put a feature's own card (reminder panel, approval request) in the shared top-center alert column.
 * @avoid Plain messages: Toast or useToast. Never position a notice with fixed and an offset.
 */
export function ToastSlot({ placement = "top-center", order, children }: ToastSlotProps) {
  const entry = useCorner(placement);
  if (!entry) return null;
  return createPortal(
    <div
      data-toast-slot=""
      className="pointer-events-auto flex max-w-full min-w-0 flex-col"
      // A bottom column is laid out from the window edge up, so its order runs the other way.
      style={order === undefined ? undefined : { order: entry.top ? order : -order }}
    >
      <OverlayMenuLayer.Provider value={LAYER.toastPopover}>{children}</OverlayMenuLayer.Provider>
    </div>,
    entry.node,
  );
}

export type ToastProps = ToastContentProps & {
  placement?: ToastPlacement;
  /** Plain-text summary for the notification log. Never include secrets or hidden context. */
  historyMessage?: string;
};

/**
 * A declarative toast owned by a component: it shows while rendered and joins the shared
 * top-end stack, or top-center for warnings and errors (unless placement is explicit).
 *
 * ```tsx
 * {saved ? <Toast tone="success" message={t("Saved")} onDismiss={() => setSaved(false)} /> : null}
 * ```
 * `tone` is required. The newest toast sits in front and up to three show at once; hovering or
 * focusing the stack fans it out. Info and success expire after five seconds, warnings after
 * eight, errors after ten, and an error with an action stays until dismissed; expiry pauses on
 * hover, focus inside, an open stack, while waiting behind the visible three, and in a hidden or
 * unfocused window. The dismiss control shows on hover and focus (always on a notice that never expires).
 * Pass `durationMs={null}` for an explicitly persistent notice.
 * @group feedback
 * @use Background or nonblocking event owned by a component: result, undo, retry, progress.
 * @avoid Save feedback next to its control: InlineMessage. Page or panel notice: Alert. Code with no component: useToast. A feature's own card: ToastSlot.
 * @arc toast-stack
 */
export function Toast({ placement, historyMessage, ...props }: ToastProps) {
  const [id] = useState(nextToastKey);
  const previous = useRef("");
  const occurrence = useRef(0);
  const title = props.title ?? "";
  const message = historyMessage ?? (typeof props.message === "string" ? props.message : "");
  const tone = props.tone;
  const persist = props.durationMs === null;
  const hasAction = Boolean(props.action || props.actions?.length);
  // Record only announced plain text; rendered children and action payloads stay out of history.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- synchronizes the mounted notice's announced text with external notification history
  useEffect(() => {
    const signature = JSON.stringify([title, message, tone]);
    if ((!title && !message) || signature === previous.current) return;
    previous.current = signature;
    const entry = {
      id: `toast:${id}:${++occurrence.current}`,
      title,
      message,
      tone,
      occurredAt: Date.now(),
      persist: persist || undefined,
      hasAction: hasAction || undefined,
    };
    for (const listener of announcementListeners) listener(entry);
  }, [id, title, message, tone, persist, hasAction]);
  return (
    <StackedToast placement={placement ?? defaultPlacement(tone)}>
      <ToastCard {...props} />
    </StackedToast>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Imperative queue: useToast() / toast
 * ------------------------------------------------------------------------------------------- */

export type ToastOptions = Omit<ToastProps, "onDismiss" | "count"> & {
  /** Reusing an id replaces that toast in place (a retry updates its own failure). */
  id?: string;
  placement?: ToastPlacement;
  /** `false` hides the dismiss control; the toast then never expires and needs `dismiss(id)`. */
  dismissible?: boolean;
  /** Runs once when the toast leaves, by expiry, the dismiss control or `dismiss(id)`. */
  onDismiss?: () => void;
};

type Entry = ToastOptions & { id: string; count?: number; fixedId?: boolean };
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

/**
 * Plain toasts compare by what the owner sees. A toast with a callback (`action`, `actions`,
 * `extra`), rows, progress or a bound id is its own operation and never merges: two identical
 * failures with different Retry callbacks stay two cards, each with its own callback.
 */
function repeatKey(options: ToastOptions, fixedId: boolean): string | null {
  if (
    fixedId ||
    options.children ||
    options.progress ||
    options.action ||
    options.actions?.length ||
    options.extra
  )
    return null;
  if (options.message !== undefined && typeof options.message !== "string") return null;
  // Placement, lifetime and dismissibility are part of what the owner sees and how it behaves.
  return JSON.stringify([
    options.tone,
    options.title ?? "",
    options.message ?? "",
    options.placement ?? "",
    options.durationMs ?? "",
    options.dismissible ?? true,
    options.dismissDisabled ?? false,
  ]);
}

function show(options: ToastOptions): string {
  // A repeat carrying its own dismiss effect would lose it inside the card it merges into.
  const key = repeatKey(options, options.id !== undefined || options.onDismiss !== undefined);
  const same =
    key === null
      ? undefined
      : queue.find((item) => !item.fixedId && repeatKey(item, false) === key);
  if (same) {
    // The same toast again: one card counts the repeats and restarts its time.
    publish(
      queue.map((item) => (item === same ? { ...item, count: (item.count ?? 1) + 1 } : item)),
    );
    return same.id;
  }
  const id = options.id ?? `toast-${++counter}`;
  const entry = { ...options, id, fixedId: options.id !== undefined };
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
    (item) => !placement || (item.placement ?? defaultPlacement(item.tone)) === placement,
  );
  publish(queue.filter((item) => !leaving.includes(item)));
  for (const item of leaving) item.onDismiss?.();
}

/**
 * Imperative toasts for code that has no component to own one (a background result). Shown by
 * the mounted `<ToastRegion />`; component-owned notices render `<Toast>` instead. `tone` is
 * required. Showing the same plain tone, title and message while it is visible adds to its "×N"
 * count and restarts its time instead of opening another toast. A toast with an action, rows,
 * progress, an `onDismiss` or an `id` is never merged: pass the operation's `id` so a retry updates
 * its own card, and never rely on text to identify an operation.
 */
export const toast = { show, update, dismiss, dismissAll } as const;

/** `show` announces immediately. Route operation failures through `reportFailure` first. */
export function useToast() {
  return toast;
}

export type ToastRegionProps = {
  /** Receives plain-text announcements for the application's existing notification history. */
  onRecord?: (entry: ToastAnnouncement) => void;
  /**
   * Distance from the window edge per corner, in px (default 12). Top corners use it to clear
   * the title bar; bottom corners to clear the status bar.
   */
  insets?: Partial<Record<ToastPlacement, number>>;
};

/**
 * Mount once per window (the workspace layout). Renders the imperative `toast` queue and sets
 * the corner insets. Component-owned `<Toast>` and `<ToastSlot>` use the same corners whether
 * or not the region is mounted.
 * @group feedback
 * @use Mount once per window to render the imperative `toast` queue and set placement insets.
 * @avoid Mounting a second region or a second toast layer. Component-owned messages: Toast.
 */
export function ToastRegion({ insets: next, onRecord }: ToastRegionProps) {
  // Subscribe before declarative toast effects announce their initial content.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- holds the application's history listener while its toast region is mounted
  useLayoutEffect(() => {
    if (!onRecord) return;
    announcementListeners.add(onRecord);
    return () => {
      announcementListeners.delete(onRecord);
    };
  }, [onRecord]);
  const handleDismiss = (id: string) => dismiss(id);
  const entries = useSyncExternalStore(
    subscribe,
    () => queue,
    () => queue,
  );
  const key = JSON.stringify(next ?? {});
  useLayoutEffect(() => {
    const parsed = JSON.parse(key) as Partial<Record<ToastPlacement, number>>;
    for (const placement of PLACEMENTS) {
      if (parsed[placement] === undefined) delete insets[placement];
      else insets[placement] = parsed[placement];
      const entry = corners.get(placement);
      if (entry) applyInset(placement, entry.node);
    }
  }, [key]);
  return (
    <>
      {entries.map(
        ({
          id,
          placement,
          dismissible = true,
          onDismiss: _onDismiss,
          fixedId: _fixedId,
          ...props
        }) => (
          <Toast
            key={id}
            {...props}
            placement={placement}
            onDismiss={dismissible ? () => handleDismiss(id) : undefined}
          />
        ),
      )}
    </>
  );
}
