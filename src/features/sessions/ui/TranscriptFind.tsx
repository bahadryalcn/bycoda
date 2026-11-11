import { Button } from "../../../shared/ui/Button";
import { Portal } from "../../../shared/ui/Portal";
import { PopoverSearchHeader } from "../../../shared/ui/PopoverSearchHeader";
import { useLocale, useT } from "../../../shared/i18n";
import {
  useCallback,
  memo,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ChevronDown, ChevronUp, Search, X } from "../../../shared/ui/icons";
import type { Block } from "../model/session";
import { findTranscriptBlocks } from "../model/transcriptFind";
import { peekTranscriptJump, subscribeTranscriptJump } from "../model/transcriptJump";
import { keybindingPressed } from "../../settings/public/settings";
import { useKeybindingShortcut } from "../../settings/public/useKeybindingShortcut";
import type { ExpandingButtonGroupItem } from "../../../shared/ui/ExpandingButtonGroup";

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
  /** Let the pane compose this action into its shared toolbar. */
  onTriggerChange?: (item: ExpandingButtonGroupItem | null) => void;
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
  onTriggerChange,
}: Props) {
  const t = useT();
  const findShortcut = useKeybindingShortcut("Editor: Find");
  const findLabel = t("Find in conversation");
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const matches = findTranscriptBlocks(blocks, query);
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
  const [adoptedJump, setAdoptedJump] = useState(0);

  const openFind = useCallback(() => {
    setOpen(true);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
  }, []);
  useEffect(() => {
    if (!onTriggerChange) return;
    onTriggerChange(
      visible
        ? {
            id: "find-conversation",
            label: findLabel,
            shortcut: findShortcut,
            icon: <Search className="icon-sm" strokeWidth={1.75} />,
            render: (renderTrigger) =>
              renderTrigger({
                "aria-expanded": open,
                onSelect: openFind,
              }),
          }
        : null,
    );
    return () => onTriggerChange(null);
  }, [onTriggerChange, visible, findLabel, findShortcut, open, openFind]);
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
  if (jump?.query && visible && adoptedJump !== jump.token) {
    const jumpMatches = findTranscriptBlocks(blocks, jump.query);
    const index = jumpMatches.indexOf(jump.blockId);
    if (index >= 0) {
      setAdoptedJump(jump.token);
      setQuery(jump.query);
      setOpen(true);
      setActive(index);
    }
  }

  useEffect(() => {
    if (!open || !visible) return;
    const frame = requestAnimationFrame(() => onNavigate(selected, query));
    return () => cancelAnimationFrame(frame);
  }, [open, visible, selected, query, onNavigate]);

  const onFindKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.isComposing) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".cm-editor, .bycoda-terminal, [role='dialog'], [data-app-search]")) return;
    const mod = event.metaKey || event.ctrlKey;
    const defaultFind = mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f";
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
  });
  useEffect(() => {
    if (!visible || !focused) return;
    const onKey = (event: KeyboardEvent) => onFindKey(event);
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible, focused]);

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
      <Search className="icon-sm" strokeWidth={1.75} />
    </Button>
  );
  // Pane-hosted portal into the title bar's trigger slot, not an overlay.
  const headerTrigger =
    !onTriggerChange && triggerContainer ? (
      <Portal target={triggerContainer}>{trigger}</Portal>
    ) : null;

  if (!open) {
    if (onTriggerChange || triggerContainer !== undefined) return headerTrigger;
    return (
      <div
        className={`pointer-events-none absolute top-2 z-(--layer-pane-sheet) ${side === "left" ? "left-3" : "right-3"}`}
      >
        <div className="pointer-events-auto">{trigger}</div>
      </div>
    );
  }

  return (
    <>
      {headerTrigger}
      <div
        className={`pointer-events-none absolute top-2 z-(--layer-pane-sheet) ${side === "left" ? "left-3" : "right-3"}`}
      >
        <div
          role="search"
          aria-label={t("Find in conversation")}
          className="pointer-events-auto flex w-[min(360px,calc(100cqw-24px))] items-center gap-1 rounded-lg border border-(--ui-tone-neutral-border) bg-(--ui-surface-floating) p-1 shadow-(--ui-elevation-floating)"
        >
          <PopoverSearchHeader
            ref={input}
            label={t("Find in conversation")}
            value={query}
            autoFocus={false}
            divider={false}
            autoCorrect="off"
            autoCapitalize="off"
            onValueChange={(value) => {
              setQuery(value);
              setActive(0);
            }}
            onSubmit={(event) => step("shiftKey" in event && event.shiftKey ? -1 : 1)}
            className="w-44"
            trailing={
              <>
                <span
                  role="status"
                  className="min-w-[10ch] shrink-0 whitespace-nowrap text-right font-mono text-ui-micro tabular-nums text-(--ui-text-secondary)"
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
                  <ChevronUp className="icon-sm" strokeWidth={1.75} />
                </FindButton>
                <FindButton
                  label={t("Next match")}
                  shortcut="Enter / F3"
                  onClick={() => step(1)}
                  disabled={!matches.length}
                >
                  <ChevronDown className="icon-sm" strokeWidth={1.75} />
                </FindButton>
                <FindButton label={t("Close find")} shortcut="Esc" onClick={closeFind}>
                  <X className="icon-sm" strokeWidth={1.75} />
                </FindButton>
              </>
            }
          />
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
      tooltip={label}
      shortcut={shortcut}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
