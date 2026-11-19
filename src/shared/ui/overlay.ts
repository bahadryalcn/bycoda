import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import { useStableCallback } from "../hooks/useStableCallback";
import { isImeComposition } from "../lib/keyboard";

export const OverlayParent = createContext<symbol | null>(null);
/** Minimum layer for menus portalled out of the current surface. */
export const OverlayMenuLayer = createContext(0);
type Entry = {
  id: symbol;
  parent: symbol | null;
  root: HTMLElement;
  modal: boolean;
  escape?: () => void;
  previous: HTMLElement | null;
  /** Where to return when `previous` is gone: the openers of the popovers it sat inside. */
  fallbacks: HTMLElement[];
  /** Surviving ancestors of the outermost opener, nearest first, for a removed opener. */
  scope: HTMLElement[];
  initialFocusSelector?: string;
  passive: boolean;
  /** Leaves this Escape to the focused element (a search field clearing itself) instead of closing. */
  keepEscape?: (event: KeyboardEvent) => boolean;
};
const entries: Entry[] = [];
/* WebKit does not focus a button on click, so `document.activeElement` is the body when a
   pointer opens an overlay. The last pointer-activated control is the focus-return fallback. */
const TRIGGER_SELECTOR =
  "button, [role='button'], [role='combobox'], [role='menuitem'], [role='tab'], a[href], summary, [tabindex]";
let pointerTrigger: HTMLElement | null = null;
let pointerTriggerAt = 0;
/** An overlay opened by a click appears within moments; an older press is not its trigger. */
const TRIGGER_WINDOW_MS = 1500;
if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    (event) => {
      pointerTriggerAt = performance.now();
      pointerTrigger =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(TRIGGER_SELECTOR)
          : null;
    },
    true,
  );
}
function returnTarget(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const active = document.activeElement;
  const pressed =
    pointerTrigger?.isConnected && performance.now() - pointerTriggerAt < TRIGGER_WINDOW_MS
      ? pointerTrigger
      : null;
  if (
    active instanceof HTMLElement &&
    active !== document.body &&
    active !== document.documentElement
  ) {
    // WebKit does not focus a clicked button, so focus lands on the focusable row around it;
    // the button the press activated is where the user expects focus back.
    if (pressed && pressed !== active && active.contains(pressed)) return pressed;
    return active;
  }
  return pressed;
}
/** How far above a removed opener a safe target is searched; farther is another context. */
const SCOPE_DEPTH = 3;
function scopeOf(opener: HTMLElement | null): HTMLElement[] {
  const scope: HTMLElement[] = [];
  for (
    let parent = opener?.parentElement;
    // A direct child of the body is an app or portal root, not a context: never a fallback.
    parent &&
    parent !== document.body &&
    parent.parentElement !== document.body &&
    scope.length < SCOPE_DEPTH;
    parent = parent.parentElement
  ) {
    scope.push(parent);
    if (parent.matches("dialog, [role='dialog'], [aria-modal='true']")) break;
  }
  return scope;
}
/**
 * Read while rendering, before descendant layout effects move focus into their portals. An
 * opener inside another open popover (a menu row that opens a dialog, a submenu) disappears
 * with that popover, so the capture also keeps what that popover will return to itself.
 */
function captureReturn() {
  const previous = returnTarget();
  const fallbacks: HTMLElement[] = [];
  const owner = previous
    ? entries.find((entry) => !entry.modal && entry.root.contains(previous))
    : null;
  if (owner) {
    if (owner.previous) fallbacks.push(owner.previous);
    fallbacks.push(...owner.fallbacks);
  }
  return { previous, fallbacks, scope: scopeOf(fallbacks[fallbacks.length - 1] ?? previous) };
}
function editable(el: HTMLElement) {
  return (
    el.isContentEditable ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement &&
      !/^(button|checkbox|radio|submit|reset|range|color|file|image)$/.test(el.type))
  );
}
function focusIsLost() {
  const active = document.activeElement;
  return !active || active === document.body || active === document.documentElement;
}
const reachable = (el: HTMLElement | null, entry: Entry): el is HTMLElement =>
  !!el && el.isConnected && !entry.root.contains(el) && !el.closest("[inert]");
/** The first control in the nearest surviving container around a removed opener. */
function focusInScope(entry: Entry) {
  for (const scope of entry.scope) {
    if (!reachable(scope, entry)) continue;
    const target = focusable(scope).find((el) => el !== scope && !entry.root.contains(el));
    if (!target) continue;
    target.focus({ preventScroll: true });
    return;
  }
}
/**
 * Returns focus to the opener when it is still here, else to the opener of the popover it came
 * from, else to the first control in the nearest surviving container around the opener. Never
 * scrolls, and never pulls the caret out of a field the user has already moved to.
 */
function restoreFocusFor(entry: Entry) {
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    !focusIsLost() &&
    !entry.root.contains(active) &&
    editable(active)
  )
    return;
  for (const candidate of [entry.previous, ...entry.fallbacks]) {
    if (!reachable(candidate, entry)) continue;
    candidate.focus({ preventScroll: true });
    if (document.activeElement !== candidate) continue;
    // The same commit may remove the opener right after (the menu item deleted its own row).
    queueMicrotask(() => {
      if (!candidate.isConnected && focusIsLost()) focusInScope(entry);
    });
    return;
  }
  focusInScope(entry);
  // Simultaneously mounted nested dialogs capture the same outside opener. It remains
  // inert after the child closes, so return to the surviving modal's initial control.
  const modalRoot = modalRoots()[0];
  const modal = entries.find((item) => item.root === modalRoot);
  if (modal && !modalRoots().some((root) => root.contains(document.activeElement)))
    initialFocus(modal).focus({ preventScroll: true });
}
/** Outer window listeners must leave Escape to the active overlay stack. */
export function hasActiveOverlay() {
  return entries.some((entry) => !entry.passive);
}
/**
 * Whether a window-level Escape listener may act on this key. Escape that cancels an IME
 * candidate, was already consumed by a control, or belongs to an open overlay is not theirs.
 */
export function shouldHandleGlobalEscape(event: KeyboardEvent) {
  return (
    event.key === "Escape" &&
    !isImeComposition(event) &&
    !event.defaultPrevented &&
    !hasActiveOverlay()
  );
}
/** A modal owns workspace keyboard scope, including its portalled children. */
export function hasActiveModalOverlay() {
  return entries.some((entry) => entry.modal);
}
const inert = new Map<HTMLElement, boolean>();
let observer: MutationObserver | undefined;
function visible(element: HTMLElement) {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (
      current.inert ||
      current.hidden ||
      style.display === "none" ||
      style.visibility === "hidden"
    )
      return false;
    if (current !== element && current instanceof HTMLDetailsElement && !current.open) {
      const summary = current.querySelector(":scope > summary");
      if (!summary?.contains(element)) return false;
    }
  }
  return true;
}
const focusable = (root: HTMLElement) => {
  const candidates = [
    root,
    ...root.querySelectorAll<HTMLElement>(
      "button, input, select, textarea, a[href], summary, [tabindex]",
    ),
  ].filter(
    (el) =>
      (el.tabIndex >= 0 ||
        (el.tagName === "SUMMARY" &&
          !el.hasAttribute("tabindex") &&
          el.parentElement instanceof HTMLDetailsElement &&
          el.parentElement.querySelector(":scope > summary") === el)) &&
      !el.matches(":disabled") &&
      visible(el),
  );
  return candidates.filter((el) => {
    if (!(el instanceof HTMLInputElement) || el.type !== "radio" || !el.name) return true;
    const group = candidates.filter(
      (item): item is HTMLInputElement =>
        item instanceof HTMLInputElement &&
        item.type === "radio" &&
        item.name === el.name &&
        item.form === el.form &&
        item.getRootNode() === el.getRootNode(),
    );
    return el === (group.find((item) => item.checked) ?? group[0]);
  });
};
function initialFocus(entry: Entry) {
  const options = focusable(entry.root);
  return (
    options.find((el) => entry.initialFocusSelector && el.matches(entry.initialFocusSelector)) ??
    options[0] ??
    entry.root
  );
}
function descendant(entry: Entry, id: symbol): boolean {
  if (entry.id === id) return true;
  const parent = entries.find((item) => item.id === entry.parent);
  return parent ? descendant(parent, id) : entry.parent === id;
}
/** Portalled child surfaces still belong to their logical parent overlay. */
export function overlayContainsTarget(id: symbol, target: Node): boolean {
  return entries.some((entry) => descendant(entry, id) && entry.root.contains(target));
}
function modalRoots() {
  const modal = [...entries].reverse().find((entry) => entry.modal);
  return modal
    ? entries.filter((entry) => descendant(entry, modal.id)).map((entry) => entry.root)
    : [];
}
/** Toasts sit above dialogs, so their stack stays reachable while a modal is open. */
const toastRegion = (node: Node | null) =>
  node instanceof Element && node.closest("[data-toast-region]") !== null;

/* ---------------------------------------------------------------------------------------------
 * Keyboard access to toasts
 *
 * A modal isolates the page and wraps Tab inside itself, so a toast above it cannot be reached
 * with the keyboard. `focusToastCard` is the way in: it remembers where focus was, Tab then walks
 * the toast controls, and Escape, or the toast leaving, puts focus back without closing the
 * dialog. Moving anywhere else, or Tab past either end, hands focus back to the modal's own trap.
 * ------------------------------------------------------------------------------------------- */
type ToastTracking = {
  origin: HTMLElement | null;
  /** The toast control that holds focus; its removal is what returns focus to `origin`. */
  held: HTMLElement | null;
  stop: () => void;
};
let toastTracking: ToastTracking | null = null;
const toastControls = () =>
  [...document.querySelectorAll<HTMLElement>("[data-toast-region]")].flatMap((region) =>
    focusable(region),
  );
function endToastTracking() {
  toastTracking?.stop();
  toastTracking = null;
}
/** Back to where focus came from; a vanished origin leaves focus unplaced rather than in a toast. */
function returnFromToast() {
  const origin = toastTracking?.origin;
  endToastTracking();
  if (origin?.isConnected && !origin.closest("[inert]") && !toastRegion(origin)) {
    origin.focus({ preventScroll: true });
  } else if (document.activeElement instanceof HTMLElement && toastRegion(document.activeElement)) {
    document.activeElement.blur();
  }
}
function onToastKey(event: KeyboardEvent): boolean {
  if (!toastTracking || !toastRegion(event.target as Node | null)) return false;
  if (event.key === "Escape") {
    returnFromToast();
  } else if (event.key === "Tab" && hasActiveModalOverlay()) {
    const controls = toastControls();
    const index = controls.indexOf(document.activeElement as HTMLElement);
    const next = controls[index + (event.shiftKey ? -1 : 1)];
    // Past either end the modal's own Tab wrap takes over, so focus never escapes it.
    if (index < 0 || !next) return false;
    next.focus({ preventScroll: true });
  } else {
    return false;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}
function beginToastTracking(origin: HTMLElement | null) {
  const onWindowKey = (event: KeyboardEvent) => {
    if (!isImeComposition(event)) onToastKey(event);
  };
  // Focus that moved on its own (the user clicked elsewhere, the modal wrapped) ends the hold.
  const onFocusIn = (event: FocusEvent) => {
    if (!toastRegion(event.target as Node | null)) endToastTracking();
    else if (toastTracking) toastTracking.held = event.target as HTMLElement;
  };
  // A removed focused toast fires no blur, so look at where focus went once the DOM settled.
  const watcher = new MutationObserver(() => {
    if (toastTracking?.held && !toastTracking.held.isConnected && focusIsLost()) returnFromToast();
  });
  window.addEventListener("keydown", onWindowKey, true);
  document.addEventListener("focusin", onFocusIn, true);
  watcher.observe(document.body, { childList: true, subtree: true });
  toastTracking = {
    origin,
    held: null,
    stop: () => {
      window.removeEventListener("keydown", onWindowKey, true);
      document.removeEventListener("focusin", onFocusIn, true);
      watcher.disconnect();
    },
  };
}
/**
 * Moves keyboard focus into the next toast card matching `card` (a selector), starting with the
 * first, and again to the following card on repeat. Works above an open modal without loosening
 * it. Returns false when no such card is showing.
 */
export function focusToastCard(card: string): boolean {
  if (typeof document === "undefined") return false;
  const cards = [
    ...document.querySelectorAll<HTMLElement>(`[data-toast-region] ${card}`),
  ].filter((item) => focusable(item).length > 0);
  if (!cards.length) return false;
  const active = document.activeElement;
  const current = cards.findIndex((item) => item.contains(active));
  const target = focusable(cards[(current + 1) % cards.length])[0];
  // A hold that outlived its toast (focus was clicked away) must not return to a stale origin.
  if (toastTracking && !toastRegion(active)) endToastTracking();
  if (!toastTracking) {
    const origin =
      active instanceof HTMLElement && !toastRegion(active) && active !== document.body
        ? active
        : null;
    beginToastTracking(origin);
  }
  target.focus({ preventScroll: true });
  if (toastTracking) toastTracking.held = target;
  return true;
}
function syncInert() {
  const roots = modalRoots();
  const next = new Set<HTMLElement>();
  const visit = (el: HTMLElement) => {
    if (roots.some((root) => root === el) || toastRegion(el)) return;
    if (roots.some((root) => el.contains(root))) {
      for (const child of el.children) if (child instanceof HTMLElement) visit(child);
    } else {
      next.add(el);
    }
  };
  if (roots.length)
    for (const child of document.body.children) if (child instanceof HTMLElement) visit(child);
  for (const [el, original] of inert) {
    if (next.has(el)) continue;
    el.inert = original;
    inert.delete(el);
  }
  for (const el of next) {
    if (inert.has(el)) continue;
    inert.set(el, el.inert);
    el.inert = true;
  }
}
function onMutation(records: MutationRecord[]) {
  const roots = modalRoots();
  if (!roots.length) return;
  // Text/children streamed inside an already isolated subtree cannot change the
  // modal boundary. Still reconcile when a portal root is inserted or moved.
  if (
    records.some((record) => {
      const movedRoot = [...record.addedNodes, ...record.removedNodes].some((node) =>
        roots.some((root) => node === root || node.contains(root)),
      );
      if (movedRoot) return true;
      return (
        !roots.some((root) => root.contains(record.target)) &&
        ![...inert.keys()].some((el) => el.contains(record.target))
      );
    })
  )
    syncInert();
}
const RECORDING_SELECTOR = '[data-shortcut-recorder-active="true"]';
function onKey(event: KeyboardEvent) {
  if (event.defaultPrevented || isImeComposition(event)) return;
  // Escape and Tab inside a toast the owner reached by shortcut belong to that toast, not the dialog.
  if (onToastKey(event)) return;
  if (event.key === "Escape") {
    const top = [...entries].reverse().find((entry) => !entry.passive);
    if (!top?.escape) return;
    if (top.keepEscape?.(event)) return;
    // A shortcut recorder that is capturing owns Escape (it cancels the capture); outside capture the dialog gets it.
    if (event.target instanceof Element && event.target.closest(RECORDING_SELECTOR)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    top.escape();
  } else if (event.key === "Tab") {
    const roots = modalRoots();
    if (!roots.length) return;
    const options = [...new Set(roots.flatMap(focusable))];
    const index = options.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? index <= 0
        ? options.length - 1
        : index - 1
      : (index + 1) % options.length;
    event.preventDefault();
    (options[next] ?? roots[0]).focus({ preventScroll: true });
  }
}
function onFocus(event: FocusEvent) {
  const roots = modalRoots();
  if (
    roots.length &&
    !roots.some((root) => root.contains(event.target as Node)) &&
    !toastRegion(event.target as Node)
  ) {
    const entry = entries.find((entry) => entry.root === roots[0])!;
    initialFocus(entry).focus({ preventScroll: true });
  }
}
export function useOverlay(
  root: { current: HTMLElement | null },
  modal: boolean,
  escape?: () => void,
  enabled = true,
  initialFocusSelector?: string,
  restoreFocus = true,
  passive = false,
  keepEscape?: (event: KeyboardEvent) => boolean,
) {
  const [id] = useState(() => Symbol("overlay"));
  // Capture before descendant layout effects can move focus into their portals.
  const [captured] = useState(captureReturn);
  const parent = useContext(OverlayParent);
  const close = useStableCallback(escape);
  const keep = useStableCallback(keepEscape);
  const restore = useRef(restoreFocus);
  const hasEscape = Boolean(escape);
  const hasKeep = Boolean(keepEscape);
  const registered = useRef<Entry | null>(null);
  useLayoutEffect(() => {
    if (!enabled || !root.current) return;
    const entry: Entry = {
      id,
      parent,
      root: root.current,
      modal,
      escape: hasEscape ? () => close?.() : undefined,
      previous: captured.previous,
      fallbacks: captured.fallbacks,
      scope: captured.scope,
      initialFocusSelector,
      passive,
      keepEscape: hasKeep ? (event) => keep?.(event) ?? false : undefined,
    };
    // Child layout effects run first: insert ancestors before their descendants.
    const child = entries.findIndex((item) => descendant(item, id));
    entries.splice(child < 0 ? entries.length : child, 0, entry);
    registered.current = entry;
    if (entries.length === 1) {
      window.addEventListener("keydown", onKey, true);
      document.addEventListener("focusin", onFocus);
      observer = new MutationObserver(onMutation);
      observer.observe(document.body, { childList: true, subtree: true });
    }
    syncInert();
    // Preserve explicit descendant autofocus, including portalled child overlays.
    if (
      modal &&
      modalRoots()[0] === entry.root &&
      !modalRoots().some((root) => root.contains(document.activeElement))
    )
      initialFocus(entry).focus({ preventScroll: true });
    return () => {
      registered.current = null;
      const wasTop = entries[entries.length - 1] === entry;
      entries.splice(entries.indexOf(entry), 1);
      syncInert();
      if (!entries.length) {
        window.removeEventListener("keydown", onKey, true);
        document.removeEventListener("focusin", onFocus);
        observer?.disconnect();
      }
      if (restore.current && (wasTop || entry.modal)) restoreFocusFor(entry);
    };
  }, [id, parent, captured, root, modal, enabled]);
  // These only change what the entry reports; re-registering would restore focus to the opener.
  useLayoutEffect(() => {
    restore.current = restoreFocus;
    const entry = registered.current;
    if (!entry) return;
    entry.escape = hasEscape ? () => close?.() : undefined;
    entry.initialFocusSelector = initialFocusSelector;
    entry.passive = passive;
    entry.keepEscape = hasKeep ? (event) => keep?.(event) ?? false : undefined;
  }, [hasEscape, initialFocusSelector, passive, hasKeep, restoreFocus]);
  return id;
}
