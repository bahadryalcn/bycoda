import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { Button } from "../../../shared/ui/Button";
import { t } from "../../../shared/i18n";
import { getPtySuggestions } from "../../../platform/tauri/pty";
import {
  localTerminalCompletion,
  localTerminalPrefix,
  safeHistoryCommand,
} from "../model/localTerminalCompletion";
import { TerminalCursorPopover } from "./TerminalCursorPopover";
import { TerminalGhostText } from "./TerminalGhostText";
import styles from "./TerminalTools.module.css";

type Snapshot = ReturnType<typeof localTerminalCompletion>;

export function LocalTerminalSuggestions({
  terminal,
  terminalId,
  explicit,
  onClose,
}: {
  terminal: Terminal;
  terminalId?: string;
  explicit: boolean;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(null);
  const [selected, setSelected] = useState(0);
  const expandedRef = useRef(explicit);
  const current = useRef(snapshot);
  const choice = useRef(selected);
  const closeRef = useRef(onClose);
  const armed = useRef(false);
  const completing = useRef(false);
  const sessionHistory = useRef<string[]>([]);
  const request = useRef(0);
  const refreshRef = useRef<() => void>(() => {});
  const publish = (value: Snapshot) => {
    const previous = current.current;
    const chosen = previous?.suggestions[choice.current];
    const next = value && previous?.prefix === value.prefix && chosen
      ? Math.max(0, value.suggestions.indexOf(chosen))
      : 0;
    current.current = value;
    choice.current = next;
    setSnapshot(value);
    setSelected(next);
  };
  const dismiss = () => {
    armed.current = false;
    request.current++;
    publish(null);
    closeRef.current();
  };
  const accept = (value: string) => {
    if (!armed.current) return;
    const fresh = localTerminalCompletion(terminal, current.current?.suggestions);
    if (!fresh || fresh.prefix !== current.current?.prefix || !fresh.suggestions.includes(value))
      return;
    dismiss();
    completing.current = true;
    try {
      terminal.paste(value.slice(fresh.prefix.length));
    } finally {
      completing.current = false;
    }
    terminal.focus();
  };
  const acceptRef = useRef(accept);
  useLayoutEffect(() => {
    closeRef.current = onClose;
    acceptRef.current = accept;
    expandedRef.current = explicit;
  });
  useEffect(() => {
    const element = terminal.element;
    if (!element) return;
    sessionHistory.current = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const suspend = () => {
      clearTimeout(timer);
      armed.current = false;
      request.current++;
      publish(null);
    };
    const refresh = () => {
      clearTimeout(timer);
      const generation = ++request.current;
      if (!armed.current || !element.contains(document.activeElement)) {
        publish(null);
        return;
      }
      const prefix = localTerminalPrefix(terminal);
      if (!prefix || !safeHistoryCommand(prefix)) {
        publish(null);
        return;
      }
      const history = sessionHistory.current;
      publish(localTerminalCompletion(terminal, history));
      if (!terminalId) return;
      timer = setTimeout(() => {
        void getPtySuggestions(terminalId, prefix)
          .then((values) => {
            if (
              generation !== request.current ||
              !armed.current ||
              !element.contains(document.activeElement) ||
              localTerminalPrefix(terminal) !== prefix
            )
              return;
            publish(localTerminalCompletion(terminal, [...history, ...values]));
          })
          .catch(() => {
            /* Static/session suggestions remain available on older native runtimes. */
          });
      }, 90);
    };
    refreshRef.current = refresh;
    const input = terminal.onData((data) => {
      if (completing.current) return;
      request.current++;
      clearTimeout(timer);
      // Inspect shell echo only. Never retain keystrokes, passwords or pasted multiline input.
      // oxlint-disable-next-line no-control-regex -- input classification only
      armed.current = data === "\x7f" || data === "\b" || !/[\x00-\x1f\x7f]/.test(data);
      publish(null);
    });
    const parsed = terminal.onWriteParsed(refresh);
    const subscriptions = [
      terminal.buffer.onBufferChange(suspend),
      terminal.onScroll(() => {
        const buffer = terminal.buffer.active;
        if (buffer.viewportY !== buffer.baseY) suspend();
        else refresh();
      }),
      terminal.onResize(refresh),
    ];
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      const values = current.current?.suggestions;
      if (
        values?.length &&
        ((event.key === "Tab" && !event.shiftKey) ||
          event.key === "ArrowRight" ||
          (event.key === "Enter" && expandedRef.current))
      ) {
        acceptRef.current(values[choice.current] ?? values[0]);
      } else if (
        values?.length &&
        (event.key === "ArrowDown" || event.key === "ArrowUp") &&
        expandedRef.current
      ) {
        const next =
          (choice.current + (event.key === "ArrowDown" ? 1 : -1) + values.length) % values.length;
        choice.current = next;
        setSelected(next);
      } else if (event.key === "Escape" && values?.length) {
        suspend();
        closeRef.current();
      } else {
        if (event.key === "Enter") {
          const command = localTerminalPrefix(terminal);
          if (command && !command.startsWith(" ") && safeHistoryCommand(command)) {
            sessionHistory.current = [
              command,
              ...sessionHistory.current.filter((value) => value !== command),
            ].slice(0, 200);
          }
          suspend();
        }
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const focus = () => {
      if (expandedRef.current) {
        armed.current = true;
        refresh();
      }
    };
    element.addEventListener("focusin", focus);
    element.addEventListener("keydown", keydown, true);
    element.addEventListener("compositionstart", suspend);
    element.addEventListener("focusout", suspend);
    return () => {
      suspend();
      input.dispose();
      parsed.dispose();
      subscriptions.forEach((subscription) => subscription.dispose());
      element.removeEventListener("focusin", focus);
      element.removeEventListener("keydown", keydown, true);
      element.removeEventListener("compositionstart", suspend);
      element.removeEventListener("focusout", suspend);
    };
  }, [terminal, terminalId]);
  useEffect(() => {
    if (!explicit) return;
    const frame = requestAnimationFrame(() => {
      terminal.focus();
      armed.current = true;
      refreshRef.current();
    });
    return () => cancelAnimationFrame(frame);
  }, [terminal, explicit]);
  if (!snapshot) return null;
  const value = snapshot.suggestions[selected] ?? snapshot.suggestions[0];
  return (
    <>
      <TerminalGhostText terminal={terminal} suffix={value.slice(snapshot.prefix.length)} />
      {explicit ? (
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
      ) : null}
    </>
  );
}
