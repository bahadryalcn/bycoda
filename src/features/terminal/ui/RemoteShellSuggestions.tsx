import { PickerList, usePickerList } from "../../../shared/ui/picker";
import { Code } from "../../../shared/ui/Code";
import { Text } from "../../../shared/ui/Text";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { useT } from "../../../shared/i18n";
import type { SshShellController, SshShellPreview } from "../model/sshShellIntegration";
import styles from "./TerminalTools.module.css";
import { TerminalGhostText } from "./TerminalGhostText";
import { isImeComposition } from "../../../shared/lib/keyboard";

async function acceptSuggestion(
  shell: SshShellController,
  value: string,
  done: () => void,
  fail: (reason: unknown) => void,
  settle: () => void,
) {
  try {
    await shell.accept(value);
    done();
  } catch (reason) {
    fail(reason);
  } finally {
    settle();
  }
}

/** Explicit selection mode. Native code, not this UI, verifies safe insertion. */
export function RemoteShellSuggestions({
  shell,
  terminal,
  onClose,
  preview,
  selectionMode = true,
}: {
  shell: SshShellController;
  terminal: Terminal | null;
  onClose: () => void;
  /** Display-only list shown between passive snapshots; keys pass to the shell. */
  preview?: SshShellPreview;
  selectionMode?: boolean;
}) {
  const t = useT();
  const [selection, setSelection] = useState({ prefix: "", value: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const snapshot = shell.state?.status === "suggestions" ? shell.state : undefined;
  // Only a live snapshot is interactive; the retained preview never accepts.
  const suggestions = [...new Set(snapshot?.suggestions ?? [])];
  const retained = !snapshot && !selectionMode ? preview : undefined;
  const shown = snapshot ? suggestions : [...new Set(retained?.suggestions ?? [])];
  const choice =
    selection.prefix === snapshot?.prefix ? Math.max(0, suggestions.indexOf(selection.value)) : 0;
  const select = (index: number) =>
    setSelection({ prefix: snapshot?.prefix ?? "", value: suggestions[index] });
  useLayoutEffect(() => {
    host.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [choice]);
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
    await acceptSuggestion(
      shell,
      value,
      () => {
        onClose();
        terminal?.focus();
      },
      (reason) => setError(String(reason)),
      () => {
        pending.current = false;
        setBusy(false);
      },
    );
  };
  const previewKeys = useRef<(event: KeyboardEvent) => void>(() => {});
  const handlePreviewKey = (event: KeyboardEvent) => {
    if (isImeComposition(event) || event.ctrlKey || event.metaKey) return;
    if (
      event.altKey &&
      (event.key === "ArrowDown" || event.key === "ArrowUp") &&
      suggestions.length
    ) {
      select(
        (choice + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length,
      );
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.altKey) return;
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
  const list = usePickerList({
    options: shown.map((value) => ({ value, title: value, disabled: busy })),
    value: shown[choice] ?? null,
    activeValue: shown[choice] ?? null,
    onActiveValueChange: (value) => {
      const index = suggestions.indexOf(value ?? "");
      if (index >= 0) select(index);
    },
    onChange: (value) => {
      if (snapshot) void accept(value);
    },
  });
  return (
    <>
      {!selectionMode && terminal && snapshot?.prefix && suggestions[choice] ? (
        <TerminalGhostText
          terminal={terminal}
          suffix={suggestions[choice].slice(snapshot.prefix.length)}
        />
      ) : null}
      <div
        ref={host}
        className={styles.command}
        tabIndex={selectionMode ? 0 : undefined}
        aria-label={t(selectionMode ? "Remote suggestion selection" : "Remote suggestion preview")}
        onKeyDown={(event) => {
          if (!selectionMode || isImeComposition(event.nativeEvent)) return;
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.length) {
            event.preventDefault();
            select(
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
          <Text as="p" size="caption" tone="muted" className={styles.hint}>
            {snapshot.user}@{snapshot.host} ·{" "}
            {snapshot.shell === "zsh"
              ? "Zsh"
              : snapshot.shell === "powershell"
                ? "PowerShell"
                : "Bash"}{" "}
            · {t("Prefix")}: <Code>{snapshot.prefix || "∅"}</Code>
          </Text>
        ) : null}
        {/* Passive previews stay a fixed list; status text would resize them per pause. */}
        {selectionMode && shell.waiting ? (
          <Text as="p" size="caption" tone="muted" role="status" className={styles.hint}>
            {t("Waiting for the shell prompt…")}
          </Text>
        ) : null}
        {(selectionMode && shell.error) || error ? (
          <Text as="p" size="caption" tone="muted" role="status" className={styles.hint}>
            {t((selectionMode && shell.error) || error)}
          </Text>
        ) : null}
        {snapshot || retained?.suggestions.length ? (
          <PickerList
            label={t("Remote command suggestions")}
            controller={list}
            checkPlacement="none"
            pointerHighlight="movement"
            className={styles.list}
            emptyLabel={t("No safe matching suggestions.")}
          />
        ) : null}
        {selectionMode ? (
          <Text as="p" size="caption" tone="muted" className={styles.hint}>
            {t(
              selectionMode
                ? "↑/↓ select · Tab/Enter insert only · Esc returns to the shell. Press Enter in the terminal to run."
                : "Tab/→ complete · Enter runs the typed command · ↑/↓ browse shell history.",
            )}
          </Text>
        ) : null}
      </div>
    </>
  );
}
