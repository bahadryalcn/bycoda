import { actionContentAttributes } from "../../../shared/ui/ActionHost";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { useEffect, useRef, useState } from "react";
import { Portal } from "../../../shared/ui/Portal";
import type { Terminal } from "@xterm/xterm";
import {
  SearchAddon,
  type ISearchOptions,
  type ISearchResultChangeEvent,
} from "@xterm/addon-search";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { Switch } from "../../../shared/ui/Switch";
import { Select } from "../../../shared/ui/Select";
import { Popover } from "../../../shared/ui/Popover";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { SearchInput } from "../../../shared/ui/SearchInput";
import {
  ChevronDown,
  ChevronUp,
  Minus,
  Plus,
  Search,
  X,
  MoreHorizontal,
} from "../../../shared/ui/icons";
import { useT } from "../../../shared/i18n";
import { LocalTerminalSuggestions } from "./LocalTerminalSuggestions";
import styles from "./TerminalTools.module.css";
import type { SshShellController } from "../model/sshShellIntegration";
import { useHideWhileTyping } from "./useHideWhileTyping";
import { isImeComposition } from "../../../shared/lib/keyboard";
import { useToast } from "../../../shared/ui/ToastRegion";
import { reportFailure } from "../../../shared/ui/reportFailure";

export type TerminalTool = "search" | "command" | "remote" | null;
const SEARCH_RESULT_LIMIT = 1000;
// Output-driven refresh window: a flowing process refreshes the count at most
// this often instead of re-scanning the whole scrollback on every write.
const SEARCH_OUTPUT_REFRESH_MS = 750;

export function TerminalTools({
  terminalId,
  terminal,
  mode: requestedMode,
  onModeChange,
  ready,
  suggestionsAllowed = true,
  remoteShell,
  onEnableShellIntegration,
  onSavedCommands,
  onSaveCommand,
  onSendSelectedText,
  onStartupReview,
  fontSize,
  savedFontSize,
  onResetFontSize,
  onFontSizeChange,
  searchDecorations,
  toolbarTarget: headerToolbarTarget,
  dockToolbarTarget,
}: {
  terminalId?: string;
  terminal: Terminal | null;
  mode: TerminalTool;
  onModeChange: (mode: TerminalTool) => void;
  ready: boolean;
  suggestionsAllowed?: boolean;
  remoteShell?: Pick<
    SshShellController,
    "automatic" | "source" | "waiting" | "request" | "dismiss" | "setSource" | "setAutomatic"
  >;
  onEnableShellIntegration?: (shell?: "bash" | "zsh" | "powershell") => void;
  onSavedCommands?: () => void;
  onSaveCommand?: () => void;
  onSendSelectedText?: (text: string) => Promise<void>;
  onStartupReview?: () => Promise<void>;
  /** Effective per-instance size, supplied by the terminal owner after zoom. */
  fontSize?: number;
  savedFontSize?: number;
  onResetFontSize?: () => void;
  onFontSizeChange?: (size: number) => void;
  /** Resolved shared semantic colors; the terminal owner refreshes these with its theme. */
  searchDecorations?: ISearchOptions["decorations"];
  toolbarTarget?: HTMLDivElement | null;
  dockToolbarTarget?: HTMLDivElement | null;
}) {
  const t = useT();
  const toast = useToast();
  const inDock = dockToolbarTarget !== undefined;
  const toolbarTarget = inDock ? dockToolbarTarget : headerToolbarTarget;
  const dockToolbarHidden = inDock && !toolbarTarget;
  const mode = dockToolbarHidden ? null : requestedMode;
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const [found, setFound] = useState(true);
  const [results, setResults] = useState<ISearchResultChangeEvent>();
  const [alternate, setAlternate] = useState(false);
  const [reviewingStartup, setReviewingStartup] = useState(false);
  const startupPending = useRef(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const searchRef = useRef<SearchAddon | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [overlayRef, typing] = useHideWhileTyping<HTMLDivElement>();
  if (dockToolbarHidden && (menuOpen || helpOpen)) {
    setMenuOpen(false);
    setHelpOpen(false);
  }

  useEffect(() => {
    if (!terminal) return;
    const sync = () => setAlternate(terminal.buffer.active.type === "alternate");
    sync();
    const subscription = terminal.buffer.onBufferChange(sync);
    return () => subscription.dispose();
  }, [terminal]);

  useEffect(() => {
    if (!terminal || mode !== "search") return;
    const addon = new SearchAddon({ highlightLimit: SEARCH_RESULT_LIMIT });
    terminal.loadAddon(addon);
    searchRef.current = addon;
    const resultSubscription = addon.onDidChangeResults(setResults);
    return () => {
      searchRef.current = null;
      resultSubscription.dispose();
      addon.clearDecorations();
      terminal.clearSelection();
      addon.dispose();
    };
  }, [terminal, mode]);

  useEffect(() => {
    if (mode !== "search" || !terminal) return;
    let pendingRefresh: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (query)
        setFound(
          searchRef.current?.findNext(query, {
            incremental: true,
            decorations: searchDecorations,
          }) ?? false,
        );
      else {
        setResults(undefined);
        searchRef.current?.clearDecorations();
        terminal?.clearSelection();
        setFound(true);
      }
    };
    // Output refresh keeps the user's position: findNext would advance from the
    // selection end, so re-run the search from the selection start instead, and
    // restore the viewport the addon may have scrolled away from.
    const refreshWhileStreaming = () => {
      const addon = searchRef.current;
      if (!query || !addon) return;
      const buffer = terminal.buffer.active;
      const following = buffer.viewportY >= buffer.baseY;
      const viewportY = buffer.viewportY;
      const options = { decorations: searchDecorations };
      if (terminal.hasSelection()) {
        // Clearing the cached term makes the addon search from the selection start,
        // so the current match is re-selected and the count is recomputed.
        addon.clearDecorations();
        setFound(addon.findPrevious(query, options));
      } else {
        setFound(addon.findNext(query, options));
      }
      if (following) terminal.scrollToBottom();
      else if (terminal.buffer.active.viewportY !== viewportY) terminal.scrollToLine(viewportY);
    };
    refresh();
    // xterm clears its selection when the grid resizes, including when this
    // compact toolbar wraps in a narrow split pane. Restore the active search.
    const subscription = terminal.onResize(() => {
      clearTimeout(pendingRefresh);
      pendingRefresh = undefined;
      refresh();
    });
    const parsed = terminal.onWriteParsed(() => {
      if (!query || pendingRefresh !== undefined) return;
      pendingRefresh = setTimeout(() => {
        pendingRefresh = undefined;
        refreshWhileStreaming();
      }, SEARCH_OUTPUT_REFRESH_MS);
    });
    return () => {
      clearTimeout(pendingRefresh);
      subscription.dispose();
      parsed.dispose();
    };
  }, [query, mode, terminal, searchDecorations]);

  useEffect(() => {
    const input = mode === "search" ? inputRef.current : null;
    input?.focus();
    input?.select();
  }, [mode]);

  const changeMode = (next: TerminalTool) => {
    setMenuOpen(false);
    setHelpOpen(false);
    onModeChange(next);
  };
  const close = () => {
    if (mode === "remote") remoteShell?.dismiss();
    changeMode(null);
    terminal?.focus();
  };
  const find = (previous: boolean) => {
    const addon = searchRef.current;
    if (addon && query) {
      const options = { decorations: searchDecorations };
      setFound(previous ? addon.findPrevious(query, options) : addon.findNext(query, options));
    }
  };

  const renderSearch = () => (
    <div
      data-terminal-tools=""
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !isImeComposition(event.nativeEvent)) {
          event.preventDefault();
          close();
        }
      }}
    >
      <div className={styles.tools}>
        <>
          <SearchInput
            ref={inputRef}
            clearable={false}
            className={styles.field}
            aria-label={t("Find in terminal")}
            placeholder={t("Find in terminal")}
            value={query}
            onChange={(event) => {
              setResults(undefined);
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !isImeComposition(event.nativeEvent)) {
                event.preventDefault();
                find(event.shiftKey);
              }
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            label={t("Previous match")}
            disabled={!query}
            onClick={() => find(true)}
          >
            <ChevronUp className="icon-sm" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            label={t("Next match")}
            disabled={!query}
            onClick={() => find(false)}
          >
            <ChevronDown className="icon-sm" />
          </Button>
          <div className={styles.hint}>
            <Text size="caption" tone="muted" role="status">
              {query && !found
                ? t("No matches")
                : query && results && searchDecorations
                  ? results.resultCount >= SEARCH_RESULT_LIMIT
                    ? t("Results limited to the first matches")
                    : results.resultIndex >= 0
                      ? `${results.resultIndex + 1} / ${results.resultCount}`
                      : t("{p0} matches", { p0: String(results.resultCount) })
                  : ""}
            </Text>
          </div>
        </>
        <Button variant="ghost" size="sm" iconOnly label={t("Close")} onClick={close}>
          <X className="icon-sm" />
        </Button>
      </div>
    </div>
  );
  /** Suggestion exposure stays explicit: the switch, the source and the note live with the menu. */
  const suggestionSettings = remoteShell ? (
    <div className={styles.suggestionSettings}>
      <Disclosure size="sm" summary={t("Suggestion settings")}>
        <div className={styles.settingRow}>
          <Text as="span" size="caption">
            {t("Show suggestions while typing")}
          </Text>
          <Switch
            checked={remoteShell.automatic}
            onCheckedChange={remoteShell.setAutomatic}
            aria-label={t("Show suggestions while typing")}
          />
        </div>
        <Select
          fieldSize="sm"
          label={t("Suggestion source")}
          value={remoteShell.source}
          onValueChange={(value) =>
            remoteShell.setSource(value as "commands" | "paths" | "history")
          }
          options={[
            { value: "commands", label: t("Commands") },
            { value: "paths", label: t("Remote paths") },
            { value: "history", label: t("Reviewed history") },
          ]}
        />
        <Text as="p" size="caption" tone="muted" className={styles.settingNote}>
          {t(
            "Session only. Remote command and path names may appear here. Reviewed history uses approved command forms; arbitrary shell completion stays on Tab.",
          )}
        </Text>
      </Disclosure>
    </div>
  ) : null;
  const showSuggestionsItem = !!remoteShell || ((!toolbarTarget || inDock) && suggestionsAllowed);
  const savedFontChanged =
    !!onResetFontSize && savedFontSize !== undefined && fontSize !== savedFontSize;
  const actionRows: DropdownMenuItem[] = [
    ...(showSuggestionsItem
      ? ([
          {
            kind: "item",
            id: remoteShell ? "suggestions" : "command",
            label: remoteShell ? t("Suggestions") : t("Command suggestions"),
            shortcut: "Ctrl+Space",
            disabled: !ready || alternate,
          },
        ] satisfies DropdownMenuItem[])
      : []),
    ...(!toolbarTarget && onSaveCommand
      ? ([
          { kind: "item", id: "save-command", label: t("Save command") },
        ] satisfies DropdownMenuItem[])
      : []),
    ...(onSavedCommands
      ? ([
          { kind: "item", id: "saved-commands", label: t("Saved commands") },
        ] satisfies DropdownMenuItem[])
      : []),
    ...(onSendSelectedText
      ? ([
          {
            kind: "item",
            id: "send-agent",
            label: t("Send to agent"),
            disabled: mode === "search" || !terminal?.hasSelection(),
          },
        ] satisfies DropdownMenuItem[])
      : []),
    ...(onEnableShellIntegration
      ? ([
          {
            kind: "item",
            id: "bash",
            label: t("Bash suggestions"),
            title: t(
              "Opens a new Bash terminal with session-only suggestions. No remote shell files are changed.",
            ),
            description: "Bash 4.4+ · ls/cd/pwd/git",
            disabled: !ready,
          },
          { kind: "item", id: "zsh", label: t("Zsh suggestions"), disabled: !ready },
          {
            kind: "item",
            id: "powershell",
            label: t("PowerShell suggestions"),
            disabled: !ready,
          },
          { kind: "item", id: "about", label: t("About shell suggestions") },
        ] satisfies DropdownMenuItem[])
      : []),
    ...(onStartupReview
      ? ([
          {
            kind: "item",
            id: "startup",
            label: t("Review startup scripts"),
            disabled: !ready || reviewingStartup,
          },
        ] satisfies DropdownMenuItem[])
      : []),
  ];
  const menuItems: DropdownMenuItem[] = [
    ...(terminal
      ? ([
          { kind: "item", id: "scroll", label: t("Scroll to bottom") },
          { kind: "item", id: "clear", label: t("Clear terminal"), disabled: alternate },
        ] satisfies DropdownMenuItem[])
      : []),
    ...(fontSize !== undefined
      ? ([
          ...(terminal ? [{ kind: "sep" } as const] : []),
          {
            kind: "content",
            id: "font",
            node: (
              <div className={styles.fontRow} role="group" aria-label={t("Terminal font size")}>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  label={t("Decrease terminal text size")}
                  disabled={!onFontSizeChange || fontSize <= 8}
                  onClick={() => onFontSizeChange?.(fontSize - 1)}
                >
                  <Minus className="icon-sm" />
                </Button>
                <Text
                  size="caption"
                  tone="secondary"
                  leading="inherit"
                  className={`${styles.fontValue} tabular-nums`}
                  role="status"
                  aria-label={t("Terminal font size")}
                >
                  {fontSize}px
                </Text>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  label={t("Increase terminal text size")}
                  disabled={!onFontSizeChange || fontSize >= 40}
                  onClick={() => onFontSizeChange?.(fontSize + 1)}
                >
                  <Plus className="icon-sm" />
                </Button>
              </div>
            ),
          },
          ...(savedFontChanged
            ? ([
                { kind: "item", id: "reset-font", label: t("Reset text size") },
              ] satisfies DropdownMenuItem[])
            : []),
        ] satisfies DropdownMenuItem[])
      : []),
    ...(actionRows.length
      ? ([
          ...(terminal || fontSize !== undefined ? [{ kind: "sep" } as const] : []),
          ...actionRows,
        ] satisfies DropdownMenuItem[])
      : []),
    ...(suggestionSettings
      ? ([
          { kind: "sep" },
          { kind: "content", id: "settings", node: suggestionSettings },
        ] satisfies DropdownMenuItem[])
      : []),
  ];
  const pick = (id: string) => {
    switch (id) {
      case "scroll":
        terminal?.scrollToBottom();
        break;
      case "clear":
        terminal?.clear();
        break;
      case "reset-font":
        onResetFontSize?.();
        break;
      case "suggestions":
        changeMode("remote");
        void remoteShell?.request(remoteShell.source);
        break;
      case "command":
        if (mode === "command") close();
        else changeMode("command");
        break;
      case "save-command":
        changeMode(null);
        onSaveCommand?.();
        return;
      case "saved-commands":
        changeMode(null);
        onSavedCommands?.();
        return;
      case "send-agent": {
        const text = terminal?.getSelection();
        if (!text?.trim() || !onSendSelectedText) return;
        changeMode(null);
        void onSendSelectedText(text)
          .catch((reason: unknown) => reportFailure(reason, { toast }))
          .catch(() => undefined);
        return;
      }
      case "bash":
      case "zsh":
      case "powershell":
        onEnableShellIntegration?.(id);
        return;
      case "about":
        setHelpOpen(true);
        return;
      case "startup": {
        if (startupPending.current || !onStartupReview) return;
        startupPending.current = true;
        setReviewingStartup(true);
        const complete = () => {
          startupPending.current = false;
          setReviewingStartup(false);
        };
        void onStartupReview().then(complete, complete);
        return;
      }
    }
    terminal?.focus();
  };
  const overlayAppearance = actionContentAttributes(
    { phase: "hover-overlay", hidden: typing, open: mode === "search" || menuOpen || helpOpen },
    styles.overlay,
  );
  const toolbar = (
    <div className={styles.menuTrigger}>
      {toolbarTarget && onSaveCommand ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            changeMode(null);
            onSaveCommand();
          }}
        >
          {t("Save command")}
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        label={t("Find in terminal")}
        shortcut="Ctrl/Cmd+F"
        aria-pressed={mode === "search"}
        disabled={!terminal}
        disabledReason={t("No terminal is open.")}
        onClick={() => {
          changeMode("search");
          inputRef.current?.focus();
          inputRef.current?.select();
        }}
      >
        <Search className="icon-sm" />
      </Button>
      {terminal || toolbarTarget ? (
        <>
          <Button
            ref={menuAnchor}
            variant="ghost"
            size="sm"
            iconOnly
            label={t("Terminal pane actions")}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            data-terminal-pane-menu-trigger=""
            disabled={!terminal && !onSavedCommands}
            disabledReason={t("No terminal is open.")}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <MoreHorizontal className="icon-sm" />
          </Button>
          {menuOpen ? (
            <DropdownMenu
              anchor={menuAnchor}
              returnFocusRef={menuAnchor}
              label={t("Terminal pane actions")}
              size="lg"
              density="compact"
              ignore="[data-terminal-pane-menu-trigger]"
              items={menuItems}
              onClose={() => setMenuOpen(false)}
              onPick={pick}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
  return (
    <>
      {toolbarTarget ? <Portal target={toolbarTarget}>{toolbar}</Portal> : null}
      {!dockToolbarHidden && (!toolbarTarget || mode === "search") && (
        <div
          {...overlayAppearance}
          ref={overlayRef}
          {...surfaceAttributes(
            { frame: "pane", edge: "all", radius: "card", variant: "floating" },
            overlayAppearance.className,
          )}
          data-open={mode === "search" || menuOpen || helpOpen || undefined}
          data-typing={typing || undefined}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {mode === "search" ? renderSearch() : toolbar}
        </div>
      )}
      {onEnableShellIntegration && helpOpen ? (
        <Popover
          anchor={menuAnchor}
          align="end"
          kind="dialog"
          aria-label={t("About shell suggestions")}
          variant="panel"
          width={340}
          onDismiss={() => setHelpOpen(false)}
        >
          <Text as="div" size="caption" tone="muted">
            <p className="mbs-2">
              {t(
                "Windows PowerShell suggestions require PowerShell 7+ and PSReadLine 2.4+. A new session starts with -NoProfile; custom profile key bindings and history settings are not loaded.",
              )}
            </p>
            <p className="mbs-2">
              {t(
                "Accepting an app suggestion inserts one line only; press Enter to run. Raw multiline paste follows PowerShell behavior and can execute commands.",
              )}
            </p>
          </Text>
        </Popover>
      ) : null}
      {ready && suggestionsAllowed && terminal ? (
        <LocalTerminalSuggestions
          terminalId={terminalId}
          terminal={terminal}
          explicit={mode === "command"}
          onClose={() => changeMode(null)}
        />
      ) : null}
    </>
  );
}
