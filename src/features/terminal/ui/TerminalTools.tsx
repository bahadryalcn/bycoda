import { useEffect, useId, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { SearchAddon } from "@xterm/addon-search";
import { Button } from "../../../shared/ui/Button";
import { Switch } from "../../../shared/ui/Switch";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { SplitButton } from "../../../shared/ui/SplitButton";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { TextField } from "../../../shared/ui/TextField";
import {
  ChevronDown,
  CheckList,
  ChevronUp,
  Search,
  Terminal as TerminalIcon,
  X,
} from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n";
import { isSingleLineCommand, terminalSuggestions } from "../model/terminalSuggestions";
import styles from "./TerminalTools.module.css";
import type { SshShellController } from "../model/sshShellIntegration";
import { RemoteShellSuggestions } from "./RemoteShellSuggestions";

export type TerminalTool = "search" | "command" | "remote" | null;

export function TerminalTools({
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
  const [command, setCommand] = useState("");
  const [selected, setSelected] = useState(0);
  const [found, setFound] = useState(true);
  const [alternate, setAlternate] = useState(false);
  const [reviewingStartup, setReviewingStartup] = useState(false);
  const startupPending = useRef(false);
  const searchRef = useRef<SearchAddon | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const commandRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const suggestions = terminalSuggestions(command, suggestionsAllowed ? "local" : "ssh");
  const choice = Math.min(selected, Math.max(0, suggestions.length - 1));
  const canInsert = suggestionsAllowed && ready && !alternate && isSingleLineCommand(command);

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
    return () => subscription.dispose();
  }, [query, mode, terminal]);

  useEffect(() => {
    const input =
      mode === "search" ? inputRef.current : mode === "command" ? commandRef.current : null;
    input?.focus();
    input?.select();
  }, [mode]);

  const close = () => {
    if (mode === "remote") remoteShell?.dismiss();
    onModeChange(null);
    terminal?.focus();
  };
  const find = (previous: boolean) => {
    const addon = searchRef.current;
    if (addon && query) setFound(previous ? addon.findPrevious(query) : addon.findNext(query));
  };
  const insert = () => {
    if (
      !ready ||
      !suggestionsAllowed ||
      !terminal ||
      !isSingleLineCommand(command) ||
      terminal.buffer.active.type === "alternate"
    )
      return;
    // paste() preserves xterm's bracketed-paste handling. No CR/Enter is sent.
    terminal.paste(command);
    setCommand("");
    close();
  };

  return (
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
        ) : (
          <Button
            variant="ghost"
            size="sm"
            title={`${t("Find in terminal")} (Ctrl/Cmd+F)`}
            aria-label={t("Find in terminal")}
            disabled={!terminal}
            onClick={() => onModeChange("search")}
          >
            <Search size={14} />
          </Button>
        )}
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
              else onModeChange("command");
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
        {remoteShell ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={!ready || alternate}
            loading={remoteShell.waiting}
            aria-label={t("Remote command suggestions")}
            title={`${t("Remote command suggestions")} (Ctrl+Space)`}
            aria-pressed={mode === "remote"}
            onClick={() => {
              onModeChange("remote");
              void remoteShell.request(remoteShell.source);
            }}
          >
            {t("Suggestions")}
          </Button>
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
      {onEnableShellIntegration ? (
        <details className="px-2 py-1 text-xs text-(--ui-text-muted)">
          <summary className="cursor-pointer">{t("Shell suggestions")}</summary>
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
        </details>
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
      {mode === null &&
      remoteShell?.automatic &&
      !alternate &&
      remoteShell.state?.status === "suggestions" &&
      remoteShell.state.suggestions?.length ? (
        <RemoteShellSuggestions
          shell={remoteShell}
          terminal={terminal}
          selectionMode={false}
          onClose={() => onModeChange(null)}
        />
      ) : null}
      {mode === "remote" && remoteShell ? (
        <RemoteShellSuggestions
          key={remoteShell.state?.requestId ?? "waiting"}
          shell={remoteShell}
          terminal={terminal}
          onClose={() => onModeChange(null)}
        />
      ) : null}
      {suggestionsAllowed && mode === "command" && (
        <div className={styles.command}>
          <div className={styles.row}>
            <TextField
              ref={commandRef}
              fieldClassName={styles.field}
              label={t("Command suggestions")}
              hideLabel
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={suggestions.length > 0}
              aria-controls={listId}
              aria-activedescendant={suggestions.length ? `${listId}-${choice}` : undefined}
              autoComplete="off"
              spellCheck={false}
              value={command}
              onChange={(event) => {
                setCommand(event.target.value);
                setSelected(0);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if ((event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.length) {
                  event.preventDefault();
                  setSelected(
                    (choice + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) %
                      suggestions.length,
                  );
                } else if (event.key === "Tab" && !event.shiftKey && suggestions[choice]) {
                  event.preventDefault();
                  setCommand(suggestions[choice]);
                  setSelected(0);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  insert();
                }
              }}
            />
            <Button variant="ghost" size="sm" disabled={!canInsert} onClick={insert}>
              {t("Insert into terminal")}
            </Button>
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label={t("Command suggestions")}
            className={styles.list}
          >
            {suggestions.map((value, index) => (
              <Button
                key={value}
                id={`${listId}-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === choice}
                variant="item"
                size="sm"
                className={styles.option}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setCommand(value);
                  setSelected(0);
                  commandRef.current?.focus();
                }}
              >
                <span className={styles.text} title={value}>
                  {value}
                </span>
              </Button>
            ))}
          </div>
          <div className={styles.hint}>
            {t("Tab to complete. Enter to insert. Run with Enter in the terminal.")}
          </div>
        </div>
      )}
    </div>
  );
}
