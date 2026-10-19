import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { Button } from "../../../shared/ui/Button";
import { t } from "../../../shared/i18n";
import { localTerminalCompletion } from "../model/localTerminalCompletion";
import { TerminalCursorPopover } from "./TerminalCursorPopover";
import styles from "./TerminalTools.module.css";

export function LocalTerminalSuggestions({
  terminal,
  explicit,
  onClose,
}: {
  terminal: Terminal;
  explicit: boolean;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<ReturnType<typeof localTerminalCompletion>>(null);
  const [selected, setSelected] = useState(0);
  const current = useRef(snapshot);
  const choice = useRef(selected);
  const closeRef = useRef(onClose);
  const armed = useRef(false);
  const completing = useRef(false);
  const dismiss = () => {
    armed.current = false;
    setSnapshot(null);
    onClose();
  };
  const accept = (value: string) => {
    if (!armed.current) return;
    const fresh = localTerminalCompletion(terminal);
    if (!fresh || fresh.prefix !== current.current?.prefix || !fresh.suggestions.includes(value))
      return;
    // Complete only the suffix. No Enter, replacement chord, or command execution.
    armed.current = false;
    setSnapshot(null);
    completing.current = true;
    try {
      terminal.paste(value.slice(fresh.prefix.length));
    } finally {
      completing.current = false;
    }
    onClose();
    terminal.focus();
  };
  const acceptRef = useRef(accept);
  useLayoutEffect(() => {
    current.current = snapshot;
    choice.current = selected;
    closeRef.current = onClose;
    acceptRef.current = accept;
  });
  useEffect(() => {
    const element = terminal.element;
    if (!element) return;
    const refresh = () => {
      if (!armed.current || !element.contains(document.activeElement)) return;
      setSnapshot(localTerminalCompletion(terminal));
      setSelected(0);
    };
    const input = terminal.onData((data) => {
      if (completing.current) return;
      // Do not collect keystrokes. Only schedule inspection of visible shell echo.
      // oxlint-disable-next-line no-control-regex -- input classification only
      armed.current = data === "\x7f" || data === "\b" || !/[\x00-\x1f\x7f]/.test(data);
      setSnapshot(null);
    });
    const parsed = terminal.onWriteParsed(refresh);
    const buffer = terminal.buffer.onBufferChange(() => {
      armed.current = false;
      setSnapshot(null);
    });
    const keydown = (event: KeyboardEvent) => {
      const values = current.current?.suggestions;
      if (!values?.length || event.isComposing || event.ctrlKey || event.metaKey || event.altKey)
        return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        setSelected(
          (value) => (value + (event.key === "ArrowDown" ? 1 : -1) + values.length) % values.length,
        );
      } else if ((event.key === "Tab" && !event.shiftKey) || event.key === "Enter") {
        acceptRef.current(values[choice.current] ?? values[0]);
      } else if (event.key === "Escape") {
        armed.current = false;
        setSnapshot(null);
        closeRef.current();
      } else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const suspend = () => {
      armed.current = false;
      setSnapshot(null);
    };
    element.addEventListener("keydown", keydown, true);
    element.addEventListener("compositionstart", suspend);
    element.addEventListener("focusout", suspend);
    return () => {
      input.dispose();
      parsed.dispose();
      buffer.dispose();
      element.removeEventListener("keydown", keydown, true);
      element.removeEventListener("compositionstart", suspend);
      element.removeEventListener("focusout", suspend);
    };
  }, [terminal]);
  useEffect(() => {
    if (!explicit) return;
    const frame = requestAnimationFrame(() => {
      terminal.focus();
      armed.current = true;
      setSnapshot(localTerminalCompletion(terminal));
    });
    return () => cancelAnimationFrame(frame);
  }, [terminal, explicit]);
  if (!snapshot) return null;
  return (
    <TerminalCursorPopover terminal={terminal} onDismiss={dismiss}>
      <div role="listbox" aria-label={t("Command suggestions")} className={styles.list}>
        {snapshot.suggestions.map((value, index) => (
          <Button
            key={value}
            variant="item"
            role="option"
            tabIndex={-1}
            aria-selected={index === selected}
            className={styles.option}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => accept(value)}
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
    </TerminalCursorPopover>
  );
}
