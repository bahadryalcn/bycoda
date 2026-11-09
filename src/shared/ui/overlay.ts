import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
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
  if (
    active instanceof HTMLElement &&
    active !== document.body &&
    active !== document.documentElement
  )
    return active;
  return pointerTrigger?.isConnected && performance.now() - pointerTriggerAt < TRIGGER_WINDOW_MS
    ? pointerTrigger
    : null;
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
}
/** Outer window listeners must leave Escape to the active overlay stack. */
export function hasActiveOverlay() {
  return entries.some((entry) => !entry.passive);
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
function syncInert() {
  const roots = modalRoots();
  const next = new Set<HTMLElement>();
  const visit = (el: HTMLElement) => {
    if (roots.some((root) => root === el)) return;
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
function onKey(event: KeyboardEvent) {
  if (event.defaultPrevented || isImeComposition(event)) return;
  if (event.key === "Escape") {
    const top = [...entries].reverse().find((entry) => !entry.passive);
    if (!top?.escape) return;
    if (top.keepEscape?.(event)) return;
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
  if (roots.length && !roots.some((root) => root.contains(event.target as Node))) {
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
  const id = useRef(Symbol("overlay")).current;
  // Capture before descendant layout effects can move focus into their portals.
  const [captured] = useState(captureReturn);
  const parent = useContext(OverlayParent);
  const close = useRef(escape);
  close.current = escape;
  const keep = useRef(keepEscape);
  keep.current = keepEscape;
  useLayoutEffect(() => {
    if (!enabled || !root.current) return;
    const entry: Entry = {
      id,
      parent,
      root: root.current,
      modal,
      escape: escape ? () => close.current?.() : undefined,
      previous: captured.previous,
      fallbacks: captured.fallbacks,
      scope: captured.scope,
      initialFocusSelector,
      passive,
      keepEscape: keepEscape ? (event) => keep.current?.(event) ?? false : undefined,
    };
    // Child layout effects run first: insert ancestors before their descendants.
    const child = entries.findIndex((item) => descendant(item, id));
    entries.splice(child < 0 ? entries.length : child, 0, entry);
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
      const wasTop = entries[entries.length - 1] === entry;
      entries.splice(entries.indexOf(entry), 1);
      syncInert();
      if (!entries.length) {
        window.removeEventListener("keydown", onKey, true);
        document.removeEventListener("focusin", onFocus);
        observer?.disconnect();
      }
      if (restoreFocus && (wasTop || entry.modal)) restoreFocusFor(entry);
    };
  }, [
    id,
    parent,
    captured,
    root,
    modal,
    Boolean(escape),
    enabled,
    initialFocusSelector,
    restoreFocus,
    passive,
    Boolean(keepEscape),
  ]);
  return id;
}
