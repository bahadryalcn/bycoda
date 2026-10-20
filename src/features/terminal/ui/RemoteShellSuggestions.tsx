import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { Button } from "../../../shared/ui/Button";
import { t } from "../../../shared/i18n";
import type { SshShellController } from "../model/sshShellIntegration";
import styles from "./TerminalTools.module.css";

/** Explicit selection mode. Native code, not this UI, verifies safe insertion. */
export function RemoteShellSuggestions({
  shell,
  terminal,
  onClose,
  selectionMode = true,
}: {
  shell: SshShellController;
  terminal: Terminal | null;
  onClose: () => void;
  selectionMode?: boolean;
}) {
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const snapshot = shell.state?.status === "suggestions" ? shell.state : undefined;
  const suggestions = [...new Set(snapshot?.suggestions ?? [])];
  const choice = Math.min(selected, Math.max(0, suggestions.length - 1));
  useEffect(() => {
    if (selectionMode) host.current?.focus();
  }, [snapshot?.requestId, selectionMode]);
  const close = () => {
    shell.dismiss();
    onClose();
    terminal?.focus();
  };
  const accept = async (value: string) => {
    if (pending.current || busy || !snapshot || terminal?.buffer.active.type === "alternate")
      return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await shell.accept(value);
      onClose();
      terminal?.focus();
    } catch (reason) {
      setError(String(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const previewKeys = useRef<(event: KeyboardEvent) => void>(() => {});
  const handlePreviewKey = (event: KeyboardEvent) => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    // Passive previews must not take over shell history or submission. Explicit
    // selection mode below owns those keys only after the owner opens it.
    if (
      !event.shiftKey &&
      (event.key === "Tab" || event.key === "ArrowRight") &&
      suggestions[choice]
    ) {
      void accept(suggestions[choice]);
    } else if (event.key === "Escape") {
      close();
    } else return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  useLayoutEffect(() => {
    previewKeys.current = handlePreviewKey;
  });
  useEffect(() => {
    const element = terminal?.element;
    if (selectionMode || !element) return;
    const listener = (event: KeyboardEvent) => previewKeys.current(event);
    element.addEventListener("keydown", listener, true);
    return () => element.removeEventListener("keydown", listener, true);
  }, [terminal, selectionMode]);
  return (
    <div
      ref={host}
      className={styles.command}
      tabIndex={selectionMode ? 0 : undefined}
      aria-label={t(selectionMode ? "Remote suggestion selection" : "Remote suggestion preview")}
      onKeyDown={(event) => {
        if (!selectionMode || event.nativeEvent.isComposing) return;
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.length) {
          event.preventDefault();
          setSelected(
            (choice + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) %
              suggestions.length,
          );
        } else if (
          (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) &&
          suggestions[choice]
        ) {
          event.preventDefault();
          void accept(suggestions[choice]);
        } else if (
          event.ctrlKey &&
          !event.altKey &&
          !event.metaKey &&
          event.key.toLowerCase() === "c"
        ) {
          event.preventDefault();
          close();
          terminal?.input("\x03");
        }
      }}
    >
      {snapshot && selectionMode ? (
        <p className={styles.hint}>
          {snapshot.user}@{snapshot.host} ·{" "}
          {snapshot.shell === "zsh"
            ? "Zsh"
            : snapshot.shell === "powershell"
              ? "PowerShell"
              : "Bash"}{" "}
          · {t("Prefix")}: <code>{snapshot.prefix || "∅"}</code>
        </p>
      ) : null}
      {shell.waiting ? (
        <p role="status" className={styles.hint}>
          {t("Waiting for the shell prompt…")}
        </p>
      ) : null}
      {shell.error || error ? (
        <p role="status" className={styles.hint}>
          {t(shell.error || error)}
        </p>
      ) : null}
      {snapshot ? (
        <div
          role="listbox"
          aria-label={t("Remote command suggestions")}
          className={styles.list}
          aria-busy={busy}
        >
          {suggestions.map((value, index) => (
            <Button
              key={value}
              role="option"
              tabIndex={-1}
              variant="item"
              size="sm"
              className={styles.option}
              aria-selected={index === choice}
              disabled={busy}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void accept(value)}
            >
              <span className={styles.text} title={value}>
                {value}
              </span>
            </Button>
          ))}
          {!suggestions.length ? (
            <p className={styles.hint}>{t("No safe matching suggestions.")}</p>
          ) : null}
        </div>
      ) : null}
      <p className={styles.hint}>
        {t(
          selectionMode
            ? "↑/↓ select · Tab/Enter insert only · Esc returns to the shell. Press Enter in the terminal to run."
            : "Tab/→ complete · Enter runs the typed command · ↑/↓ browse shell history.",
        )}
      </p>
    </div>
  );
}
