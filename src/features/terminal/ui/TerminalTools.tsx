import { useEffect, useId, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { SearchAddon } from "@xterm/addon-search";
import { Button } from "../../../shared/ui/Button";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { TextField } from "../../../shared/ui/TextField";
import {
  ChevronDown,
  ChevronUp,
  Search,
  Terminal as TerminalIcon,
  X,
} from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n";
import { isSingleLineCommand, terminalSuggestions } from "../model/terminalSuggestions";
import styles from "./TerminalTools.module.css";

export type TerminalTool = "search" | "command" | null;

export function TerminalTools({
  terminal,
  mode,
  onModeChange,
  ready,
}: {
  terminal: Terminal | null;
  mode: TerminalTool;
  onModeChange: (mode: TerminalTool) => void;
  ready: boolean;
}) {
  useLocale();
  const [query, setQuery] = useState("");
  const [command, setCommand] = useState("");
  const [selected, setSelected] = useState(0);
  const [found, setFound] = useState(true);
  const [alternate, setAlternate] = useState(false);
  const searchRef = useRef<SearchAddon | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const commandRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const suggestions = terminalSuggestions(command);
  const choice = Math.min(selected, Math.max(0, suggestions.length - 1));
  const canInsert = ready && !alternate && isSingleLineCommand(command);

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
      {mode === "command" && (
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
