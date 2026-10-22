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
import { isTerminalTextEdit } from "../model/terminalKeys";
import { TerminalCursorPopover } from "./TerminalCursorPopover";
import { TerminalGhostText } from "./TerminalGhostText";
import styles from "./TerminalTools.module.css";

type Snapshot = ReturnType<typeof localTerminalCompletion>;

/** A text edit whose echo never arrives (e.g. echo off) drops the stale list. */
const ECHO_GRACE_MS = 150;

function sameSnapshot(a: Snapshot, b: Snapshot) {
  if (!a || !b) return a === b;
  return (
    a.prefix === b.prefix &&
    a.suggestions.length === b.suggestions.length &&
    a.suggestions.every((value, index) => value === b.suggestions[index])
  );
}

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
  // Typed but not yet echoed: the visible list stays mounted, but accepting
  // would read the un-echoed buffer, so keys pass through to the shell.
  const stale = useRef(false);
  const nativeValues = useRef<string[]>([]);
  const sessionHistory = useRef<string[]>([]);
  const request = useRef(0);
  const refreshRef = useRef<() => void>(() => {});
  const publish = (value: Snapshot) => {
    const previous = current.current;
    const chosen = previous?.suggestions[choice.current];
    if (sameSnapshot(previous, value)) return;
    const next =
      value && chosen && value.suggestions.includes(chosen) ? value.suggestions.indexOf(chosen) : 0;
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
    let echoTimer: ReturnType<typeof setTimeout> | undefined;
    const suspend = () => {
      clearTimeout(timer);
      clearTimeout(echoTimer);
      stale.current = false;
      nativeValues.current = [];
      armed.current = false;
      request.current++;
      publish(null);
    };
    const refresh = () => {
      clearTimeout(timer);
      clearTimeout(echoTimer);
      stale.current = false;
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
      // Keep earlier native matches until the new lookup lands so the list
      // narrows in place instead of collapsing to static entries first.
      publish(localTerminalCompletion(terminal, [...history, ...nativeValues.current]));
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
            nativeValues.current = values;
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
      clearTimeout(echoTimer);
      // Inspect shell echo only. Never retain keystrokes, passwords or pasted multiline input.
      armed.current = isTerminalTextEdit(data);
      if (!armed.current || !current.current) {
        stale.current = false;
        publish(null);
        return;
      }
      stale.current = true;
      echoTimer = setTimeout(() => {
        stale.current = false;
        publish(null);
      }, ECHO_GRACE_MS);
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
      const values = stale.current ? undefined : current.current?.suggestions;
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
