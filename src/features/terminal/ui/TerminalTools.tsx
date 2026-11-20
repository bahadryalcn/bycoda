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
import { SplitButton } from "../../../shared/ui/SplitButton";
import { Popover } from "../../../shared/ui/Popover";
import { MenuRow } from "../../../shared/ui/MenuRow";
import { Divider } from "../../../shared/ui/Divider";
import { SearchInput } from "../../../shared/ui/SearchInput";
import {
  ChevronDown,
  CheckList,
  ChevronUp,
  Minus,
  Plus,
  Search,
  Terminal as TerminalIcon,
  X,
  Info,
  MoreHorizontal,
} from "../../../shared/ui/icons";
import { useT } from "../../../shared/i18n";
import { LocalTerminalSuggestions } from "./LocalTerminalSuggestions";
import styles from "./TerminalTools.module.css";
import type { SshShellController } from "../model/sshShellIntegration";
import { useHideWhileTyping } from "./useHideWhileTyping";
import { isImeComposition } from "../../../shared/lib/keyboard";

export type TerminalTool = "search" | "command" | "remote" | null;
const SEARCH_RESULT_LIMIT = 1000;
// Output-driven refresh window: a flowing process refreshes the count at most
// this often instead of re-scanning the whole scrollback on every write.
const SEARCH_OUTPUT_REFRESH_MS = 750;

export function TerminalTools({
  terminalId,
  terminal,
  mode,
  onModeChange,
  ready,
  suggestionsAllowed = true,
  remoteShell,
  onEnableShellIntegration,
  onSavedCommands,
  onSaveCommand,
  onStartupReview,
  fontSize,
  savedFontSize,
  onResetFontSize,
  onFontSizeChange,
  searchDecorations,
  toolbarTarget,
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
  onStartupReview?: () => Promise<void>;
  /** Effective per-instance size, supplied by the terminal owner after zoom. */
  fontSize?: number;
  savedFontSize?: number;
  onResetFontSize?: () => void;
  onFontSizeChange?: (size: number) => void;
  /** Resolved shared semantic colors; the terminal owner refreshes these with its theme. */
  searchDecorations?: ISearchOptions["decorations"];
  toolbarTarget?: HTMLDivElement | null;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const [found, setFound] = useState(true);
  const [results, setResults] = useState<ISearchResultChangeEvent>();
  const [alternate, setAlternate] = useState(false);
  const [reviewingStartup, setReviewingStartup] = useState(false);
  const startupPending = useRef(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpAnchor = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [overlayRef, typing] = useHideWhileTyping<HTMLDivElement>();

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

  const renderControls = (search: boolean) => (
    <div
      data-terminal-tools={search ? "" : undefined}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !isImeComposition(event.nativeEvent)) {
          event.preventDefault();
          close();
        }
      }}
    >
      <div className={search ? styles.tools : styles.menuActions}>
        {search ? (
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
            <Text size="caption" tone="muted" role="status" className={styles.hint}>
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
          </>
        ) : null}
        {!search && remoteShell ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              align="start"
              disabled={!ready || alternate}
              loading={mode === "remote" && remoteShell.waiting}
              shortcut="Ctrl+Space"
              onClick={() => {
                changeMode("remote");
                void remoteShell.request(remoteShell.source);
              }}
            >
              {t("Suggestions")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              align="start"
              disabled={!ready || alternate}
              onClick={() => {
                remoteShell.setSource("history");
                changeMode("remote");
                void remoteShell.request("history");
              }}
            >
              {t("Reviewed history")}
            </Button>
          </>
        ) : null}
        {!search && !toolbarTarget && onSaveCommand ? (
          <Button
            variant="ghost"
            size="sm"
            align="start"
            onClick={() => {
              changeMode(null);
              onSaveCommand();
            }}
          >
            {t("Save command")}
          </Button>
        ) : null}
        {!search && onSavedCommands ? (
          <Button
            variant="ghost"
            size="sm"
            align="start"
            onClick={() => {
              changeMode(null);
              onSavedCommands();
            }}
          >
            {t("Saved commands")}
          </Button>
        ) : null}
        {!search && onEnableShellIntegration ? (
          <SplitButton
            variant="ghost"
            size="sm"
            disabled={!ready}
            label={t("Bash suggestions")}
            menuLabel={t("Shell suggestions")}
            actions={[
              {
                id: "zsh",
                label: t("Zsh suggestions"),
                onSelect: () => onEnableShellIntegration("zsh"),
              },
              {
                id: "powershell",
                label: t("PowerShell suggestions"),
                onSelect: () => onEnableShellIntegration("powershell"),
              },
            ]}
            tooltip={t(
              "Opens a new Bash terminal with session-only suggestions. No remote shell files are changed.",
            )}
            tooltipDetails={["Bash 4.4+ · ls/cd/pwd/git"]}
            onClick={() => onEnableShellIntegration("bash")}
          />
        ) : null}
        {!search && onStartupReview ? (
          <Button
            variant="ghost"
            size="sm"
            align="start"
            label={t("Review startup scripts")}
            loading={reviewingStartup}
            disabled={!ready}
            onClick={() => {
              if (startupPending.current) return;
              startupPending.current = true;
              setReviewingStartup(true);
              const complete = () => {
                startupPending.current = false;
                setReviewingStartup(false);
              };
              void onStartupReview().then(complete, complete);
            }}
          >
            <CheckList className="icon-sm" />
            {t("Review startup scripts")}
          </Button>
        ) : null}
        {(search || mode === "remote") && (
          <Button variant="ghost" size="sm" iconOnly label={t("Close")} onClick={close}>
            <X className="icon-sm" />
          </Button>
        )}
      </div>
      {!search && remoteShell ? (
        <Disclosure size="sm" className={styles.settings} summary={t("Suggestion settings")}>
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
      ) : null}
    </div>
  );
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
        onClick={() => {
          changeMode("search");
          inputRef.current?.focus();
          inputRef.current?.select();
        }}
      >
        <Search className="icon-sm" />
      </Button>
      {!toolbarTarget && suggestionsAllowed && (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          label={t("Command suggestions")}
          shortcut="Ctrl+Space"
          aria-pressed={mode === "command"}
          disabled={!ready || alternate}
          onClick={() => {
            if (mode === "command") close();
            else changeMode("command");
          }}
        >
          <TerminalIcon className="icon-sm" />
        </Button>
      )}
      {!toolbarTarget && onEnableShellIntegration ? (
        <Button
          ref={helpAnchor}
          variant="ghost"
          size="sm"
          iconOnly
          label={t("About shell suggestions")}
          aria-expanded={helpOpen}
          aria-haspopup="dialog"
          onClick={() => setHelpOpen(!helpOpen)}
        >
          <Info aria-hidden className="icon-sm" />
        </Button>
      ) : null}
      {terminal || toolbarTarget ? (
        <>
          <Button
            ref={menuAnchor}
            variant="ghost"
            size="sm"
            iconOnly
            label={t("Terminal pane actions")}
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            disabled={!terminal && !onSavedCommands}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <MoreHorizontal className="icon-sm" />
          </Button>
          {menuOpen ? (
            <Popover
              anchor={menuAnchor}
              align="end"
              width={320}
              solid
              kind="dialog"
              aria-label={t("Terminal pane actions")}
              onDismiss={() => {
                setMenuOpen(false);
                if (toolbarTarget) setHelpOpen(false);
              }}
            >
              <div className={styles.menuBody}>
                {terminal ? (
                  <>
                    <MenuRow
                      type="button"
                      onClick={() => {
                        terminal.scrollToBottom();
                        setMenuOpen(false);
                        terminal.focus();
                      }}
                    >
                      {t("Scroll to bottom")}
                    </MenuRow>
                    <MenuRow
                      type="button"
                      disabled={alternate}
                      onClick={() => {
                        terminal.clear();
                        setMenuOpen(false);
                        terminal.focus();
                      }}
                    >
                      {t("Clear terminal")}
                    </MenuRow>
                  </>
                ) : null}
                {fontSize !== undefined ? (
                  <>
                    {terminal ? <Divider className="my-1" /> : null}
                    <div
                      className={styles.fontRow}
                      role="group"
                      aria-label={t("Terminal font size")}
                    >
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
                        className={styles.fontValue}
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
                      {onResetFontSize ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          label={t("Reset text size")}
                          disabled={savedFontSize === undefined || fontSize === savedFontSize}
                          onClick={() => {
                            onResetFontSize();
                            setMenuOpen(false);
                            terminal?.focus();
                          }}
                        >
                          {t("Reset")}
                        </Button>
                      ) : null}
                    </div>
                  </>
                ) : null}
                {remoteShell ||
                (!toolbarTarget && onSaveCommand) ||
                onSavedCommands ||
                onEnableShellIntegration ||
                onStartupReview ? (
                  <div>
                    {terminal || fontSize !== undefined ? <Divider className="my-1" /> : null}
                    {renderControls(false)}
                    {toolbarTarget && onEnableShellIntegration ? (
                      <MenuRow
                        ref={helpAnchor}
                        type="button"
                        aria-expanded={helpOpen}
                        aria-haspopup="dialog"
                        onClick={() => setHelpOpen(!helpOpen)}
                      >
                        {t("About shell suggestions")}
                      </MenuRow>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Popover>
          ) : null}
        </>
      ) : null}
    </div>
  );
  return (
    <>
      {/* This target is the server's fixed header, not a floating overlay. */}
      {toolbarTarget ? <Portal target={toolbarTarget}>{toolbar}</Portal> : null}
      {(!toolbarTarget || mode === "search") && (
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
          {mode === "search" ? renderControls(true) : toolbar}
        </div>
      )}
      {onEnableShellIntegration && helpOpen ? (
        <Popover
          anchor={helpAnchor}
          align="end"
          kind="dialog"
          aria-label={t("About shell suggestions")}
          width={340}
          onDismiss={() => setHelpOpen(false)}
        >
          <Text as="div" size="caption" tone="muted" className="p-3">
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
