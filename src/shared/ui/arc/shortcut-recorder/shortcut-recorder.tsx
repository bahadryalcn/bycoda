"use client";

import { useT } from "../../../i18n";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Variants } from "motion/react";
import { Button } from "../../Button";
import { RotateCcw, Search, X } from "../../icons";
import { SearchInput, SearchInputGroup } from "../../SearchInput";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./shortcut-recorder.module.css";

/* ================================================================================================
 * Shortcut model. The model and formatter live in `../../shortcut` (one formatter for the app);
 * they are re-exported here so registry consumers keep their imports.
 * ============================================================================================== */

import {
  formatShortcut,
  keyId,
  normalizeShortcut,
  shortcutFromEvent,
  shortcutTokens,
  splitShortcut,
  usePlatform,
  type Platform,
} from "../../shortcut";

export {
  formatShortcut,
  formatShortcutLabel,
  keyId,
  matchesShortcut,
  normalizeShortcut,
  parseShortcutLabel,
  shortcutFromEvent,
  shortcutTokens,
  usePlatform,
} from "../../shortcut";
export type { Platform, ShortcutChord, ShortcutSequence, ShortcutToken } from "../../shortcut";

const subscribe = () => () => {};
/** Reduced motion that only applies after hydration, so server and client render the same styles. */
function useReducedFlag() {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return !!useReducedMotion() && hydrated;
}

/** Keys held down right now, by physical id. Clears on window blur, and after Command lifts (macOS drops the other keyups). */
export function usePressedKeys(enabled = true) {
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!enabled) return;
    const update = (change: (next: Set<string>) => void) =>
      setHeld((current) => {
        const next = new Set(current);
        change(next);
        return next.size === current.size && [...next].every((key) => current.has(key))
          ? current
          : next;
      });
    const down = (event: KeyboardEvent) => {
      const id = keyId(event);
      if (id) update((next) => next.add(id));
    };
    const up = (event: KeyboardEvent) => {
      const id = keyId(event);
      update((next) => {
        if (id) next.delete(id);
        if (id === "meta")
          [...next].forEach((key) => {
            if (!["ctrl", "alt", "shift"].includes(key)) next.delete(key);
          });
        if (!event.metaKey) next.delete("meta");
        if (!event.ctrlKey) next.delete("ctrl");
        if (!event.altKey) next.delete("alt");
        if (!event.shiftKey) next.delete("shift");
      });
    };
    const clear = () => setHeld((current) => (current.size ? new Set() : current));
    // Capture phase, so keys still register while a focused recorder keeps the chord from bubbling.
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, [enabled]);
  return enabled ? held : EMPTY;
}
const EMPTY: ReadonlySet<string> = new Set();

/* ================================================================================================
 * ShortcutKbd and ShortcutKeys live in `./shortcut-keys` (no Button dependency, so tooltips can
 * render key caps without an import cycle).
 * ============================================================================================== */

import { ShortcutKbd, ShortcutKeys } from "./shortcut-keys";
export { Kbd, ShortcutKbd, ShortcutKeys } from "./shortcut-keys";
export type { KbdProps, ShortcutKbdProps, ShortcutKeysProps } from "./shortcut-keys";

/* ================================================================================================
 * ShortcutRecorder
 * ============================================================================================== */

export interface ShortcutBinding {
  shortcut: string;
  label: string;
}

export interface ShortcutRecorderProps {
  label: string;
  recording?: boolean;
  onRecordingChange?: (recording: boolean) => void;
  displayText?: ReactNode;
  hideActions?: boolean;
  hideLabel?: boolean;
  value?: string | null;
  defaultValue?: string | null;
  /** `replaced` is the binding the new shortcut was taken from after "Use anyway", so the caller can unbind it. */
  onValueChange?: (value: string | null, details: { replaced?: ShortcutBinding }) => void;
  /** What the reset button restores. Defaults to `defaultValue`. */
  resetValue?: string | null;
  /** Shortcuts already in use. Recording one of them asks before taking it. */
  bindings?: ShortcutBinding[];
  /** Also warn about combinations the browser or system keeps, such as ⌘W and ⌘C. On by default. */
  warnReserved?: boolean;
  /** Require ⌘, Ctrl, or ⌥ (function keys are always allowed). On by default. */
  requireModifier?: boolean;
  platform?: Platform;
  placeholder?: string;
  description?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

const RESERVED: ShortcutBinding[] = [
  { shortcut: "mod+w", label: "Close tab" },
  { shortcut: "mod+t", label: "New tab" },
  { shortcut: "mod+n", label: "New window" },
  { shortcut: "mod+q", label: "Quit" },
  { shortcut: "mod+l", label: "Address bar" },
  { shortcut: "mod+r", label: "Reload" },
  { shortcut: "mod+shift+t", label: "Reopen tab" },
  { shortcut: "mod+c", label: "Copy" },
  { shortcut: "mod+v", label: "Paste" },
  { shortcut: "mod+x", label: "Cut" },
  { shortcut: "mod+z", label: "Undo" },
  { shortcut: "mod+a", label: "Select all" },
];

type Pending = { shortcut: string; conflict: ShortcutBinding; reserved: boolean };

const chip: Variants = {
  enter: { opacity: 0, scale: 0.72, y: 4 },
  rest: (index: number) => ({
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      ...motionTokens.spring.snappy,
      delay: index * motionTokens.stagger.item,
      opacity: { duration: 0.14, delay: index * motionTokens.stagger.item },
    },
  }),
  exit: {
    opacity: 0,
    scale: 0.8,
    transition: { duration: 0.1 },
  },
};
const chipFade: Variants = {
  enter: { opacity: 0 },
  rest: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.1 } },
  exit: { opacity: 0, transition: { duration: 0.06 } },
};

/**
 * A field that records a keyboard shortcut. Press it, then press the combination: held modifiers light up as caps while you
 * build the chord, the finished shortcut settles into place, and a combination that is already taken asks before it is used.
 * Escape cancels, Backspace clears, and the reset button restores the default. Caps follow the platform: ⌘ on a Mac, Ctrl elsewhere.
 * Capture never starts from focus alone, controlled or not: only a pointer press or Enter/Space starts it, and a visible Cancel
 * ends it (hidden with `hideActions`, whose owner then supplies its own Cancel).
 */
export function ShortcutRecorder({
  label,
  recording: externalRecording,
  onRecordingChange,
  displayText,
  hideActions = false,
  hideLabel = false,
  value,
  defaultValue = null,
  onValueChange,
  resetValue,
  bindings = [],
  warnReserved = true,
  requireModifier = true,
  platform: platformProp,
  placeholder = "Record shortcut",
  description,
  disabled = false,
  id,
  className,
}: ShortcutRecorderProps) {
  const t = useT();
  const reduced = useReducedFlag();
  const platform = usePlatform(platformProp);
  const uid = useId();
  const buttonId = id ?? `${uid}-button`;
  const labelId = `${uid}-label`,
    messageId = `${uid}-message`;

  const [inner, setInner] = useState<string | null>(defaultValue);
  const current = value !== undefined ? value : inner;
  const restoreTo = resetValue !== undefined ? resetValue : defaultValue;

  const [innerRecording, setInnerRecording] = useState(false);
  const recording = externalRecording ?? innerRecording;
  const setRecording = (next: boolean) => {
    if (externalRecording === undefined) setInnerRecording(next);
    onRecordingChange?.(next);
  };
  const [live, setLive] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [nudge, setNudge] = useState<string | null>(null);
  const [settled, setSettled] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  // The owner ending a recording clears the stale announcement (adjusted during render).
  const [seenRecording, setSeenRecording] = useState(externalRecording);
  if (seenRecording !== externalRecording) {
    setSeenRecording(externalRecording);
    if (externalRecording === false) setAnnouncement("");
  }
  const buttonRef = useRef<HTMLButtonElement>(null);
  /* The message slot animates to the measured height of its content, so a swap to a message that wraps grows instead of snapping. */
  const [messageHeight, setMessageHeight] = useState<number | null>(null);
  const measureMessage = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      setMessageHeight(node.getBoundingClientRect().height),
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      setMessageHeight(null);
    };
  }, []);

  const spoken = (shortcut: string | null) =>
    shortcut ? formatShortcut(shortcut, platform).spoken : "none";

  const commit = useCallback(
    (next: string | null, replaced?: ShortcutBinding) => {
      setPending(null);
      setNudge(null);
      if (value === undefined) setInner(next);
      onValueChange?.(next, { replaced });
      setSettled((count) => count + 1);
      setAnnouncement(
        next
          ? t("Shortcut set to {p0}", { p0: formatShortcut(next, platform).spoken })
          : t("Shortcut cleared"),
      );
    },
    [onValueChange, platform, value],
  );

  const start = () => {
    if (disabled) return;
    setPending(null);
    setNudge(null);
    setLive([]);
    setRecording(true);
    setAnnouncement(t("Del disables · Esc cancels"));
  };
  const stop = () => {
    setRecording(false);
    setLive([]);
  };

  const conflictFor = (shortcut: string): Pending | null => {
    const normal = normalizeShortcut(shortcut, platform);
    if (current && normalizeShortcut(current, platform) === normal) return null;
    const taken = bindings.find(
      (binding) => normalizeShortcut(binding.shortcut, platform) === normal,
    );
    if (taken) return { shortcut, conflict: taken, reserved: false };
    const reserved = warnReserved
      ? RESERVED.find((binding) => normalizeShortcut(binding.shortcut, platform) === normal)
      : undefined;
    return reserved ? { shortcut, conflict: reserved, reserved: true } : null;
  };

  const liveMods = (event: ReactKeyboardEvent) => {
    const mods: string[] = [];
    if (event.ctrlKey && platform === "mac") mods.push("ctrl");
    if (event.altKey) mods.push("alt");
    if (event.shiftKey) mods.push("shift");
    if (platform === "mac" ? event.metaKey : event.ctrlKey) mods.push("mod");
    if (platform === "other" && event.metaKey) mods.push("meta");
    return mods;
  };

  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (externalRecording !== undefined) return;
    if (!recording) {
      if ((event.key === "Backspace" || event.key === "Delete") && current) {
        event.preventDefault();
        commit(null);
      }
      return;
    }
    if (
      event.key === "Tab" &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      stop();
      return;
    }
    // The chord belongs to the recorder: keep it from the page's own shortcuts, such as a ⌘K command menu.
    event.preventDefault();
    event.stopPropagation();
    const bare = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    if (bare && event.key === "Escape") {
      stop();
      setAnnouncement(t("Recording canceled"));
      return;
    }
    if (bare && (event.key === "Backspace" || event.key === "Delete")) {
      stop();
      commit(null);
      return;
    }
    const shortcut = shortcutFromEvent(event.nativeEvent, platform);
    if (!shortcut) {
      setLive(liveMods(event));
      return;
    }
    const { mods, key } = splitShortcut(shortcut);
    const strong = mods.has("mod") || mods.has("ctrl") || mods.has("alt") || mods.has("meta");
    if (requireModifier && !strong && !/^f\d+$/.test(key)) {
      const hint = t("Record shortcut");
      setNudge(hint);
      setAnnouncement(hint);
      setLive(liveMods(event));
      return;
    }
    stop();
    const conflict = conflictFor(shortcut);
    if (conflict) {
      setPending(conflict);
      setAnnouncement(t("Shortcut conflict: {p0}", { p0: conflict.conflict.label }));
      return;
    }
    commit(shortcut);
  }
  function onKeyUp(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (recording) setLive(liveMods(event));
  }

  const shown = pending?.shortcut ?? current;
  const tokens = recording
    ? shortcutTokens(live.join("+"), platform)
    : shown
      ? shortcutTokens(shown, platform)
      : [];
  const state = recording ? "recording" : pending ? "conflict" : "idle";
  const canReset = !recording && (pending !== null || (current ?? null) !== (restoreTo ?? null));
  const canClear = !recording && !!current && !pending;
  const message = pending
    ? {
        tone: "warning" as const,
        key: `c-${pending.shortcut}`,
        body: (
          <>
            {t("Shortcut conflict: {p0}", { p0: "" })}{" "}
            <strong className={styles.strong}>{pending.conflict.label}</strong>
          </>
        ),
      }
    : nudge
      ? { tone: "hint" as const, key: `n-${nudge}`, body: <>{nudge}</> }
      : recording && externalRecording === undefined
        ? { tone: "hint" as const, key: "rec", body: <>{t("Del disables · Esc cancels")}</> }
        : description
          ? { tone: "hint" as const, key: "d", body: <>{description}</> }
          : null;

  useEffect(() => {
    if (!settled) return;
    const timer = window.setTimeout(() => setSettled(0), 700);
    return () => window.clearTimeout(timer);
  }, [settled]);

  return (
    <div
      className={[styles.field, className].filter(Boolean).join(" ")}
      data-disabled={disabled || undefined}
      data-shortcut-recorder-active={recording ? "true" : undefined}
    >
      <span id={labelId} className={hideLabel ? styles.srOnly : styles.label}>
        {label}
      </span>
      <div className={styles.control} data-state={state}>
        <button
          ref={buttonRef}
          id={buttonId}
          type="button"
          className={styles.recorder}
          disabled={disabled}
          aria-labelledby={externalRecording === undefined ? `${labelId} ${buttonId}` : undefined}
          aria-describedby={message ? messageId : undefined}
          aria-label={label}
          aria-pressed={recording}
          data-capturing={recording || undefined}
          onClick={(event) => {
            if (externalRecording !== undefined) {
              if (!recording) start();
              return;
            }
            if (recording) {
              if (event.detail !== 0) {
                stop();
                setAnnouncement(t("Recording canceled"));
              }
              return;
            }
            start();
          }}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onBlur={() => {
            if (recording) {
              stop();
              setNudge(null);
            }
          }}
        >
          <span className={styles.srOnly}>
            {recording ? t("Press keys") : shown ? spoken(shown) : placeholder}
          </span>
          <span className={styles.row} aria-hidden="true">
            {recording && <span className={styles.dot} data-reduced={reduced || undefined} />}
            <AnimatePresence initial={false} mode="popLayout">
              {displayText !== undefined ? (
                <span className={styles.placeholder} data-shortcut-display>
                  {displayText}
                </span>
              ) : (
                tokens.map((token, index) => (
                  <motion.span
                    key={`${token.id}`}
                    layout={reduced ? false : "position"}
                    custom={recording ? 0 : index}
                    variants={reduced ? chipFade : chip}
                    initial="enter"
                    animate="rest"
                    exit="exit"
                    transition={reduced ? { duration: 0 } : { layout: motionTokens.spring.snappy }}
                    className={styles.chipSlot}
                  >
                    <ShortcutKbd
                      pressed={recording || (settled > 0 && !pending)}
                      data-tone={pending ? "warning" : undefined}
                    >
                      {token.label}
                    </ShortcutKbd>
                  </motion.span>
                ))
              )}
              {displayText === undefined && tokens.length === 0 && (
                <motion.span
                  key={recording ? "prompt" : "placeholder"}
                  className={styles.placeholder}
                  data-recording={recording || undefined}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.08 } }}
                  transition={
                    reduced
                      ? { duration: 0.1 }
                      : { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.enter] }
                  }
                >
                  {recording ? t("Press keys") : placeholder}
                </motion.span>
              )}
            </AnimatePresence>
          </span>
        </button>

        {!hideActions && (
          <span className={styles.actions}>
            <AnimatePresence initial={false}>
              {recording && (
                <motion.span
                  key="cancel"
                  className={styles.actionSlot}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.1 } }}
                  transition={reduced ? { duration: 0 } : motionTokens.spring.snappy}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    motion="none"
                    // Keep focus on the recorder so pressing Cancel does not blur-stop first and lose the click.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      stop();
                      setAnnouncement(t("Recording canceled"));
                      buttonRef.current?.focus();
                    }}
                  >
                    {t("Cancel")}
                  </Button>
                </motion.span>
              )}
              {canReset && (
                <motion.span
                  key="reset"
                  className={styles.actionSlot}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.1 } }}
                  transition={reduced ? { duration: 0 } : motionTokens.spring.snappy}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    motion="none"
                    label={`Reset to ${restoreTo ? formatShortcut(restoreTo, platform).spoken : "none"}`}
                    onClick={() => {
                      commit(restoreTo ?? null);
                      buttonRef.current?.focus();
                    }}
                  >
                    <RotateCcw aria-hidden="true" />
                  </Button>
                </motion.span>
              )}
              {canClear && (
                <motion.span
                  key="clear"
                  className={styles.actionSlot}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.1 } }}
                  transition={reduced ? { duration: 0 } : motionTokens.spring.snappy}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    motion="none"
                    label={t("Clear shortcut")}
                    onClick={() => {
                      commit(null);
                      buttonRef.current?.focus();
                    }}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </motion.span>
              )}
            </AnimatePresence>
          </span>
        )}
      </div>

      <AnimatePresence initial={false}>
        {message && (
          <motion.div
            key="slot"
            className={styles.messageSlot}
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: messageHeight ?? "auto", opacity: 1 }}
            exit={{
              height: 0,
              opacity: 0,
              transition: reduced
                ? { duration: 0 }
                : { height: motionTokens.spring.smooth, opacity: { duration: 0.1 } },
            }}
            transition={
              reduced
                ? { duration: 0 }
                : {
                    height: motionTokens.spring.smooth,
                    opacity: { duration: motionTokens.duration.fast },
                  }
            }
          >
            <div ref={measureMessage}>
              <AnimatePresence initial={false} mode="popLayout">
                <motion.div
                  key={message.key}
                  id={messageId}
                  className={styles.message}
                  data-tone={message.tone}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: "0.35em" }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.08 } }}
                  transition={{
                    duration: reduced ? 0.1 : motionTokens.duration.standard,
                    ease: [...motionTokens.ease.enter],
                  }}
                >
                  <span className={styles.messageText}>{message.body}</span>
                  {pending && (
                    <span className={styles.messageActions}>
                      <Button
                        variant="ghost"
                        tone="warning"
                        size="sm"
                        motion="none"
                        onClick={() => {
                          const taken = pending;
                          commit(taken.shortcut, taken.reserved ? undefined : taken.conflict);
                          buttonRef.current?.focus();
                        }}
                      >
                        {t("Use anyway")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        motion="none"
                        onClick={() => {
                          setPending(null);
                          setAnnouncement(t("Cancelled"));
                          buttonRef.current?.focus();
                        }}
                      >
                        {t("Cancel")}
                      </Button>
                    </span>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <span className={styles.srOnly} role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}

/* ================================================================================================
 * ShortcutList
 * ============================================================================================== */

export interface ShortcutListItem {
  label: string;
  shortcut: string;
  /** Extra words that match when searching. */ keywords?: string;
}
export interface ShortcutListGroup {
  label: string;
  items: ShortcutListItem[];
}

export interface ShortcutListProps {
  groups: ShortcutListGroup[];
  /** Accessible name of the list. */
  label?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Light up caps as keys are held, and fade rows that do not use the held modifiers. On by default. */
  highlightPressed?: boolean;
  platform?: Platform;
  className?: string;
}

/**
 * A searchable, grouped cheatsheet. Holding a modifier lights that cap in every row and fades rows that do not use it, so people
 * can explore by holding keys; a row whose whole combination is down lights up. Search matches names, groups, and key names such as "cmd k".
 */
export function ShortcutList({
  groups,
  label = "Keyboard shortcuts",
  searchable = true,
  searchPlaceholder = "Search shortcuts",
  highlightPressed = true,
  platform: platformProp,
  className,
}: ShortcutListProps) {
  useT();
  const reduced = useReducedFlag();
  const platform = usePlatform(platformProp);
  const held = usePressedKeys(highlightPressed);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const heldMods = useMemo(
    () => [...held].filter((key) => ["meta", "ctrl", "alt", "shift"].includes(key)),
    [held],
  );
  const words = query
    .trim()
    .toLowerCase()
    .replace(/[⌘]/g, " cmd ")
    .replace(/[⇧]/g, " shift ")
    .replace(/[⌥]/g, " alt ")
    .replace(/[⌃]/g, " ctrl ")
    .split(/[\s+]+/)
    .filter(Boolean);
  const aliases: Record<string, string> = {
    cmd: "command",
    command: "command",
    ctrl: "control",
    control: "control",
    opt: "option",
    option: platform === "mac" ? "option" : "alt",
    alt: platform === "mac" ? "option" : "alt",
    win: "windows",
    esc: "escape",
    return: platform === "mac" ? "return" : "enter",
  };

  const filtered = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (!words.length) return true;
        const tokens = shortcutTokens(item.shortcut, platform);
        const haystack =
          `${item.label} ${group.label} ${item.keywords ?? ""} ${tokens.map((token) => `${token.spoken} ${token.label}`).join(" ")}`.toLowerCase();
        return words.every(
          (word) => haystack.includes(aliases[word] ?? word) || haystack.includes(word),
        );
      }),
    }))
    .filter((group) => group.items.length);

  const total = filtered.reduce((sum, group) => sum + group.items.length, 0);
  const rowTransition = reduced ? { duration: 0 } : motionTokens.spring.smooth;

  return (
    <section className={[styles.list, className].filter(Boolean).join(" ")} aria-label={label}>
      {searchable && (
        <SearchInputGroup appearance="field" className={styles.searchRow}>
          <Search className={styles.searchIcon} aria-hidden="true" />
          <SearchInput
            ref={searchRef}
            focusOwner="group"
            className={styles.search}
            type="search"
            placeholder={searchPlaceholder}
            value={query}
            aria-label={searchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                setQuery("");
              }
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <span className={styles.count} aria-live="polite">
            {query ? `${total} ${total === 1 ? "match" : "matches"}` : ""}
          </span>
        </SearchInputGroup>
      )}

      <div className={styles.groups}>
        <AnimatePresence initial={false}>
          {filtered.map((group) => (
            <motion.section
              key={group.label}
              className={styles.group}
              aria-label={group.label}
              initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
              transition={rowTransition}
            >
              <h4 className={styles.groupLabel}>{group.label}</h4>
              <ul className={styles.rows}>
                <AnimatePresence initial={false}>
                  {group.items.map((item) => {
                    const tokens = shortcutTokens(item.shortcut, platform);
                    const ids = tokens.map((token) => token.id);
                    const match = held.size > 0 && ids.every((key) => held.has(key));
                    const dim =
                      heldMods.length > 0 && !match && !heldMods.every((mod) => ids.includes(mod));
                    return (
                      <motion.li
                        key={item.label}
                        className={styles.item}
                        data-match={match || undefined}
                        data-dim={dim || undefined}
                        initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                        transition={rowTransition}
                      >
                        <span className={styles.itemInner}>
                          <span className={styles.itemLabel}>{item.label}</span>
                          <ShortcutKeys
                            shortcut={item.shortcut}
                            platform={platform}
                            pressed={held}
                            size="sm"
                          />
                        </span>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            </motion.section>
          ))}
        </AnimatePresence>
        {total === 0 && <p className={styles.empty}>No shortcuts match “{query.trim()}”</p>}
      </div>
    </section>
  );
}

export default ShortcutRecorder;
