import { useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { SearchAddon } from "@xterm/addon-search";
import { Button } from "../../../shared/ui/Button";
import { Switch } from "../../../shared/ui/Switch";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { SplitButton } from "../../../shared/ui/SplitButton";
import { Popover } from "../../../shared/ui/Popover";
import { SearchInput } from "../../../shared/ui/SearchInput";
import {
  ChevronDown,
  CheckList,
  ChevronUp,
  Search,
  Terminal as TerminalIcon,
  X,
  Info,
  MoreHorizontal,
} from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n";
import { LocalTerminalSuggestions } from "./LocalTerminalSuggestions";
import { TerminalCursorPopover } from "./TerminalCursorPopover";
import styles from "./TerminalTools.module.css";
import type { SshShellController } from "../model/sshShellIntegration";
import { RemoteShellSuggestions } from "./RemoteShellSuggestions";
import { localTerminalPrefix } from "../model/localTerminalCompletion";

export type TerminalTool = "search" | "command" | "remote" | null;

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
  onStartupReview,
}: {
  terminalId?: string;
  terminal: Terminal | null;
  mode: TerminalTool;
  onModeChange: (mode: TerminalTool) => void;
  ready: boolean;
  suggestionsAllowed?: boolean;
  remoteShell?: SshShellController;
  onEnableShellIntegration?: (shell?: "bash" | "zsh" | "powershell") => void;
  onSavedCommands?: () => void;
  onStartupReview?: () => Promise<void>;
}) {
  useLocale();
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const [found, setFound] = useState(true);
  const [alternate, setAlternate] = useState(false);
  const [reviewingStartup, setReviewingStartup] = useState(false);
  const startupPending = useRef(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpAnchor = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // undefined: not measured yet; null: the prompt line cannot be read.
  const [promptPrefix, setPromptPrefix] = useState<string | null>();
  const retaining = !!remoteShell?.preview && mode === null;

  // Presentation only: narrows the retained passive list to the echoed prompt
  // text while the next native snapshot is pending. Never used for insertion.
  useEffect(() => {
    if (!terminal || !retaining) return;
    const sync = () => setPromptPrefix(localTerminalPrefix(terminal));
    sync();
    const subscription = terminal.onWriteParsed(sync);
    return () => {
      subscription.dispose();
      setPromptPrefix(undefined);
    };
  }, [terminal, retaining]);

  useEffect(() => {
    if (!terminal) return;
    const sync = () => setAlternate(terminal.buffer.active.type === "alternate");
    sync();
    const subscription = terminal.buffer.onBufferChange(sync);
    return () => subscription.dispose();
  }, [terminal]);

  useEffect(() => {
    if (!terminal || mode !== "search") return;
    const addon = new SearchAddon();
    terminal.loadAddon(addon);
    searchRef.current = addon;
    return () => {
      searchRef.current = null;
      addon.clearDecorations();
      terminal.clearSelection();
      addon.dispose();
    };
  }, [terminal, mode]);

  useEffect(() => {
    if (mode !== "search" || !terminal) return;
    const refresh = () => {
      if (query) setFound(searchRef.current?.findNext(query, { incremental: true }) ?? false);
      else {
        searchRef.current?.clearDecorations();
        terminal?.clearSelection();
        setFound(true);
      }
    };
    refresh();
    // xterm clears its selection when the grid resizes, including when this
    // compact toolbar wraps in a narrow split pane. Restore the active search.
    const subscription = terminal.onResize(refresh);
    const parsed = terminal.onWriteParsed(refresh);
    return () => {
      subscription.dispose();
      parsed.dispose();
    };
  }, [query, mode, terminal]);

  useEffect(() => {
    const input = mode === "search" ? inputRef.current : null;
    input?.focus();
    input?.select();
  }, [mode]);

  const changeMode = (next: TerminalTool) => {
    setMenuOpen(false);
    onModeChange(next);
  };
  const close = () => {
    if (mode === "remote") remoteShell?.dismiss();
    changeMode(null);
    terminal?.focus();
  };
  const find = (previous: boolean) => {
    const addon = searchRef.current;
    if (addon && query) setFound(previous ? addon.findPrevious(query) : addon.findNext(query));
  };

  const controls = (
    <div
      data-terminal-tools=""
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          close();
        }
      }}
    >
      <div className={styles.tools}>
        {mode === "search" ? (
          <>
            <SearchInput
              ref={inputRef}
              clearable={false}
              className={styles.field}
              aria-label={t("Find in terminal")}
              placeholder={t("Find in terminal")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  find(event.shiftKey);
                }
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              title={t("Previous match")}
              aria-label={t("Previous match")}
              disabled={!query}
              onClick={() => find(true)}
            >
              <ChevronUp size={14} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title={t("Next match")}
              aria-label={t("Next match")}
              disabled={!query}
              onClick={() => find(false)}
            >
              <ChevronDown size={14} />
            </Button>
            <span role="status" className={styles.hint}>
              {query && !found ? t("No matches") : ""}
            </span>
          </>
        ) : null}
        {suggestionsAllowed && (
          <Button
            variant="ghost"
            size="sm"
            title={`${t("Command suggestions")} (Ctrl+Space)`}
            aria-label={t("Command suggestions")}
            aria-pressed={mode === "command"}
            disabled={!ready || alternate}
            onClick={() => {
              if (mode === "command") close();
              else changeMode("command");
            }}
          >
            <TerminalIcon size={14} />
          </Button>
        )}
        {onEnableShellIntegration ? (
          <SplitButton
            variant="ghost"
            size="sm"
            disabled={!ready}
            label={`${t("Bash suggestions")} (4.4+)`}
            menuLabel={t("Shell suggestions")}
            actions={[
              {
                id: "zsh",
                label: `${t("Zsh suggestions")} (5.1+)`,
                onSelect: () => onEnableShellIntegration("zsh"),
              },
              {
                id: "powershell",
                label: `${t("PowerShell suggestions")} (7+ · PSReadLine 2.4+)`,
                onSelect: () => onEnableShellIntegration("powershell"),
              },
            ]}
            title={`${t(
              "Opens a new Bash terminal with session-only suggestions. No remote shell files are changed.",
            )} (Bash 4.4+ · ls/cd/pwd/git)`}
            onClick={() => onEnableShellIntegration("bash")}
          />
        ) : null}
        {onStartupReview ? (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            label={t("Review startup scripts")}
            tooltip={t("Review startup scripts")}
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
            <CheckList size={14} />
          </Button>
        ) : null}
        {onEnableShellIntegration ? (
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
            <Info aria-hidden size={14} />
          </Button>
        ) : null}
        {mode && (
          <Button
            variant="ghost"
            size="sm"
            title={t("Close")}
            aria-label={t("Close")}
            onClick={close}
          >
            <X size={14} />
          </Button>
        )}
      </div>
      {onEnableShellIntegration && helpOpen ? (
        <Popover
          anchor={helpAnchor}
          align="end"
          role="dialog"
          aria-label={t("About shell suggestions")}
          width={340}
          onDismiss={() => setHelpOpen(false)}
        >
          <div className="p-3 text-xs text-(--ui-text-muted)">
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
          </div>
        </Popover>
      ) : null}
      {remoteShell ? (
        <details className="px-2 py-1 text-xs text-(--ui-text-muted)">
          <summary className="cursor-pointer">{t("Suggestion settings")}</summary>
          <div className="flex flex-wrap items-center gap-2 py-1">
            <Switch
              checked={remoteShell.automatic}
              onCheckedChange={remoteShell.setAutomatic}
              aria-label={t("Show suggestions while typing")}
            />
            <span>{t("Show suggestions while typing")}</span>
            <SegmentedControl
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
          </div>
          <p>
            {t(
              "Session only. Remote command and path names may appear here. Reviewed history uses approved command forms; arbitrary shell completion stays on Tab.",
            )}
          </p>
        </details>
      ) : null}
    </div>
  );
  // Before the first measurement the screen still shows the retained prefix.
  const shownPrefix = promptPrefix === undefined ? remoteShell?.preview?.prefix : promptPrefix;
  const preview =
    retaining && remoteShell?.preview && shownPrefix != null
      ? {
          prefix: shownPrefix,
          suggestions: remoteShell.preview.suggestions.filter(
            (value) => value.startsWith(shownPrefix) && value !== shownPrefix,
          ),
        }
      : undefined;
  const showRemote =
    terminal &&
    remoteShell &&
    !alternate &&
    (mode === "remote" ||
      (mode === null &&
        remoteShell.automatic &&
        ((remoteShell.state?.status === "suggestions" && !!remoteShell.state.suggestions?.length) ||
          !!preview?.suggestions.length)));
  return (
    <>
      {mode === "search" ? (
        controls
      ) : (
        <div className={styles.menuTrigger}>
          {onEnableShellIntegration ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={!ready || alternate}
              tooltip={t(
                "Opens a new Bash terminal with session-only suggestions. No remote shell files are changed.",
              )}
              onClick={() => onEnableShellIntegration("bash")}
            >
              <TerminalIcon aria-hidden size={14} />
              {t("Bash suggestions")}
            </Button>
          ) : null}
          {remoteShell ? (
            <>
              <Button
                variant="ghost"
                size="sm"
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
          {onSavedCommands ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={!ready || alternate}
              onClick={onSavedCommands}
            >
              {t("Saved commands")}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            label={t("Find in terminal")}
            shortcut="Ctrl/Cmd+F"
            disabled={!terminal}
            onClick={() => changeMode("search")}
          >
            <Search size={14} />
          </Button>
          {terminal ? (
            <>
              <Button
                ref={menuAnchor}
                variant="ghost"
                size="sm"
                iconOnly
                label={`${t("Terminal")} · ${t("More actions")}`}
                aria-expanded={menuOpen}
                aria-haspopup="dialog"
                onClick={() => setMenuOpen(!menuOpen)}
              >
                <MoreHorizontal size={14} />
              </Button>
              {menuOpen ? (
                <Popover
                  anchor={menuAnchor}
                  align="end"
                  width={360}
                  role="dialog"
                  aria-label={`${t("Terminal")} · ${t("More actions")}`}
                  onDismiss={() => setMenuOpen(false)}
                >
                  {controls}
                  <div className={styles.row}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        terminal.scrollToBottom();
                        setMenuOpen(false);
                        terminal.focus();
                      }}
                    >
                      {t("Scroll to bottom")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={alternate}
                      onClick={() => {
                        terminal.clear();
                        setMenuOpen(false);
                        terminal.focus();
                      }}
                    >
                      {t("Clear terminal")}
                    </Button>
                  </div>
                </Popover>
              ) : null}
            </>
          ) : null}
        </div>
      )}
      {ready && suggestionsAllowed && terminal ? (
        <LocalTerminalSuggestions
          terminalId={terminalId}
          terminal={terminal}
          explicit={mode === "command"}
          onClose={() => changeMode(null)}
        />
      ) : null}
      {showRemote ? (
        <>
          <TerminalCursorPopover
            terminal={terminal}
            onDismiss={() => {
              remoteShell.dismiss();
              changeMode(null);
            }}
          >
            <RemoteShellSuggestions
              shell={remoteShell}
              terminal={terminal}
              preview={preview}
              selectionMode={mode === "remote"}
              onClose={() => changeMode(null)}
            />
          </TerminalCursorPopover>
        </>
      ) : null}
    </>
  );
}
