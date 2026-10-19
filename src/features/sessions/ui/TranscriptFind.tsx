import { Button } from "../../../shared/ui/Button";
import { createPortal } from "react-dom";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { t, useLocale } from "../../../shared/i18n";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ChevronDown, ChevronUp, Search, X } from "../../../shared/ui/icons";
import type { Block } from "../model/session";
import { findTranscriptBlocks } from "../model/transcriptFind";
import { peekTranscriptJump, subscribeTranscriptJump } from "../model/transcriptJump";
import { keybindingPressed } from "../../settings/model/settings";
import { useKeybindingShortcut } from "../../settings/model/useKeybindingShortcut";

type Props = {
  blocks: Block[];
  visible: boolean;
  focused: boolean;
  onNavigate: (blockId: string | null, query?: string) => boolean;
  /** Lets a jump from cross-session search open this find with its query. */
  sessionId?: string;
  side?: "left" | "right";
  /** Mount the action in the pane header while keeping search state with the transcript. */
  triggerContainer?: HTMLElement | null;
  /** Tells the owner when results depend on live text, so it can feed every frame. */
  onSearchingChange?: (searching: boolean) => void;
};

export const TranscriptFind = memo(function TranscriptFind({
  blocks,
  visible,
  focused,
  onNavigate,
  sessionId,
  side = "right",
  triggerContainer,
  onSearchingChange,
}: Props) {
  useLocale();
  const findShortcut = useKeybindingShortcut("Editor: Find");
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const matches = useMemo(() => findTranscriptBlocks(blocks, query), [blocks, query]);
  const searching = visible && open && query.trim() !== "";
  useEffect(() => {
    onSearchingChange?.(searching);
    return () => onSearchingChange?.(false);
  }, [searching, onSearchingChange]);
  const selected = matches[Math.min(active, matches.length - 1)] ?? null;
  const jump = useSyncExternalStore(
    subscribeTranscriptJump,
    () => peekTranscriptJump(sessionId ?? ""),
    () => null,
  );
  const adoptedJump = useRef(0);
  const [jumpTarget, setJumpTarget] = useState<string | null>(null);

  const openFind = () => {
    setOpen(true);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
  };
  const closeFind = () => {
    setOpen(false);
    onNavigate(null);
  };
  const step = (direction: number) => {
    if (!matches.length) return;
    setActive((index) => (index + direction + matches.length) % matches.length);
  };

  // A result opened from the cross-session search arrives as a jump carrying
  // its query: show it here, on the matching block, so next/previous work.
  // A query this find would not match is left to the jump's own highlight.
  useEffect(() => {
    if (!jump?.query || !visible || adoptedJump.current === jump.token) return;
    if (!findTranscriptBlocks(blocks, jump.query).includes(jump.blockId)) return;
    adoptedJump.current = jump.token;
    setQuery(jump.query);
    setOpen(true);
    setJumpTarget(jump.blockId);
  }, [jump, visible, blocks]);

  useEffect(() => {
    if (!jumpTarget) return;
    const index = matches.indexOf(jumpTarget);
    if (index >= 0) setActive(index);
    setJumpTarget(null);
  }, [jumpTarget, matches]);

  useEffect(() => {
    if (!open || !visible) return;
    const frame = requestAnimationFrame(() => onNavigate(selected, query));
    return () => cancelAnimationFrame(frame);
  }, [open, visible, selected, query, onNavigate]);

  useEffect(() => {
    if (!visible || !focused) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".cm-editor, .bycoda-terminal, [role='dialog'], [data-app-search]"))
        return;
      const mod = event.metaKey || event.ctrlKey;
      const defaultFind =
        mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f";
      if (keybindingPressed("Editor: Find", event, defaultFind)) {
        event.preventDefault();
        event.stopPropagation();
        openFind();
      } else if (defaultFind) {
        event.preventDefault();
        event.stopPropagation();
      } else if (
        open &&
        (event.key === "F3" || (mod && !event.altKey && event.key.toLowerCase() === "g"))
      ) {
        event.preventDefault();
        event.stopPropagation();
        step(event.shiftKey ? -1 : 1);
      } else if (open && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeFind();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (!visible) return null;

  const trigger = (
    <Button
      variant="ghost"
      size="sm"
      motion="none"
      iconOnly
      label={t("Find in conversation")}
      shortcut={findShortcut}
      aria-expanded={open}
      data-no-drag
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={openFind}
    >
      <Search className="size-3.5" strokeWidth={1.75} />
    </Button>
  );
  const headerTrigger = triggerContainer ? createPortal(trigger, triggerContainer) : null;

  if (!open) {
    if (triggerContainer !== undefined) return headerTrigger;
    return (
      <div
        className={`pointer-events-none absolute top-2 z-40 ${side === "left" ? "left-3" : "right-3"}`}
      >
        <div className="pointer-events-auto">{trigger}</div>
      </div>
    );
  }

  return (
    <>
      {headerTrigger}
      <div
        className={`pointer-events-none absolute top-2 z-40 ${side === "left" ? "left-3" : "right-3"}`}
      >
        <div
          role="search"
          aria-label={t("Find in conversation")}
          className="pointer-events-auto flex w-[min(360px,calc(100cqw-24px))] items-center gap-1 rounded-lg border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) p-1 shadow-lg backdrop-blur-xl"
        >
          <Search
            className="ml-1 size-3.5 shrink-0 text-(--ui-text-secondary)"
            strokeWidth={1.75}
          />
          <SearchInput
            ref={input}
            type="text"
            value={query}
            aria-label={t("Find in conversation")}
            placeholder={t("Find in conversation")}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") {
                event.preventDefault();
                step(event.shiftKey ? -1 : 1);
              }
            }}
            className="w-44 min-w-0 flex-1 bg-transparent text-[12px] text-(--ui-tone-neutral-fg) outline-none placeholder:text-(--ui-text-secondary)"
          />
          <span
            aria-live="polite"
            className="min-w-[10ch] shrink-0 whitespace-nowrap text-right font-mono text-[11px] tabular-nums text-(--ui-text-secondary)"
          >
            {query.trim()
              ? matches.length
                ? t("{p0} of {p1}", {
                    p0: Math.min(active, matches.length - 1) + 1,
                    p1: matches.length,
                  })
                : t("No results")
              : ""}
          </span>
          <FindButton
            label={t("Previous match")}
            shortcut="Shift+Enter / Shift+F3"
            onClick={() => step(-1)}
            disabled={!matches.length}
          >
            <ChevronUp className="size-3.5" strokeWidth={1.75} />
          </FindButton>
          <FindButton
            label={t("Next match")}
            shortcut="Enter / F3"
            onClick={() => step(1)}
            disabled={!matches.length}
          >
            <ChevronDown className="size-3.5" strokeWidth={1.75} />
          </FindButton>
          <FindButton label={t("Close find")} shortcut="Esc" onClick={closeFind}>
            <X className="size-3.5" strokeWidth={1.75} />
          </FindButton>
        </div>
      </div>
    </>
  );
});

function FindButton({
  label,
  shortcut,
  onClick,
  disabled,
  children,
}: {
  label: string;
  shortcut: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  useLocale();
  return (
    <Button
      variant="ghost"
      type="button"
      title={label}
      shortcut={shortcut}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
