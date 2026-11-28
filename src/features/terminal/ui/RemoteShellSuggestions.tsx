import { PickerList, usePickerList } from "../../../shared/ui/picker";
import { Code } from "../../../shared/ui/Code";
import { Text } from "../../../shared/ui/Text";
import { InlineError } from "../../../shared/ui/InlineError";
import { LiveText } from "../../../shared/ui/LiveText";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { useT } from "../../../shared/i18n";
import type { SshShellController, SshShellPreview } from "../model/sshShellIntegration";
import styles from "./TerminalTools.module.css";
import { TerminalGhostText } from "./TerminalGhostText";
import { isImeComposition } from "../../../shared/lib/keyboard";

async function acceptSuggestion(
  insert: () => Promise<void>,
  done: () => void,
  fail: (reason: unknown) => void,
  settle: () => void,
) {
  try {
    await insert();
    done();
  } catch (reason) {
    fail(reason);
  } finally {
    settle();
  }
}

/** Passive catalog list or explicit selection. Native code, not this UI, verifies insertion. */
export function RemoteShellSuggestions({
  shell,
  terminal,
  onClose,
  preview,
  canAcceptPreview = () => true,
  selectionMode = true,
}: {
  shell: SshShellController;
  terminal: Terminal | null;
  onClose: () => void;
  /** Passive list filtered from the prompt catalog for the echoed prefix. */
  preview?: SshShellPreview;
  /** False while a typed edit has not echoed yet: completion keys go to the shell. */
  canAcceptPreview?: () => boolean;
  selectionMode?: boolean;
}) {
  const t = useT();
  const [selection, setSelection] = useState({ prefix: "", value: "" });
  const [busy, setBusy] = useState(false);
  const [acceptFailure, setAcceptFailure] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const snapshot = shell.state?.status === "suggestions" ? shell.state : undefined;
  // An explicit snapshot wins; otherwise the catalog list for the echoed prefix
  // (passive, or an explicit selection opened without a shell request).
  const catalogList = !snapshot ? preview : undefined;
  const active = snapshot ?? catalogList;
  const suggestions = [...new Set(active?.suggestions ?? [])];
  const choice =
    selection.prefix === active?.prefix ? Math.max(0, suggestions.indexOf(selection.value)) : 0;
  const select = (index: number) =>
    setSelection({ prefix: active?.prefix ?? "", value: suggestions[index] });
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
    if (pending.current || busy || !active || terminal?.buffer.active.type === "alternate") return;
    const fromCatalog = !snapshot && catalogList;
    if (fromCatalog && !canAcceptPreview()) return;
    pending.current = true;
    setBusy(true);
    setAcceptFailure("");
    await acceptSuggestion(
      () => (fromCatalog ? shell.acceptCatalog(fromCatalog.prefix, value) : shell.accept(value)),
      () => {
        onClose();
        terminal?.focus();
      },
      (reason) => setAcceptFailure(String(reason)),
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
    // Passive lists must not take over shell history or submission. Explicit
    // selection mode below owns those keys only after the owner opens it. An
    // un-echoed edit leaves Tab/Right to the shell instead of a stale prefix.
    if (
      !event.shiftKey &&
      (event.key === "Tab" || event.key === "ArrowRight") &&
      suggestions[choice] &&
      (snapshot || canAcceptPreview())
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
    options: suggestions.map((value) => ({ value, title: value, disabled: busy })),
    value: suggestions[choice] ?? null,
    activeValue: suggestions[choice] ?? null,
    onActiveValueChange: (value) => {
      const index = suggestions.indexOf(value ?? "");
      if (index >= 0) select(index);
    },
    onChange: (value) => {
      void accept(value);
    },
  });
  return (
    <>
      {!selectionMode && terminal && active?.prefix && suggestions[choice] ? (
        <TerminalGhostText
          terminal={terminal}
          suffix={suggestions[choice].slice(active.prefix.length)}
        />
      ) : null}
      <div
        ref={host}
        className={styles.command}
        tabIndex={selectionMode ? 0 : undefined}
        aria-label={
          selectionMode ? t("Remote suggestion selection") : t("Remote suggestion preview")
        }
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
          <LiveText
            size="caption"
            tone="muted"
            className={styles.hint}
            text={t("Waiting for the shell prompt…")}
          />
        ) : null}
        {selectionMode && shell.notice && !shell.noticeDetails ? (
          <LiveText size="caption" tone="muted" className={styles.hint} text={shell.notice} />
        ) : null}
        {selectionMode && shell.notice && shell.noticeDetails ? (
          <InlineError details={shell.noticeDetails}>{shell.notice}</InlineError>
        ) : acceptFailure ? (
          <InlineError details={acceptFailure}>{t("Could not insert the command.")}</InlineError>
        ) : null}
        {snapshot || (selectionMode ? catalogList : catalogList?.suggestions.length) ? (
          <div className={styles.list}>
            <PickerList
              label={t("Remote command suggestions")}
              controller={list}
              checkPlacement="none"
              pointerHighlight="movement"
              emptyLabel={t("No safe matching suggestions.")}
            />
          </div>
        ) : null}
        {selectionMode ? (
          <Text as="p" size="caption" tone="muted" className={styles.hint}>
            {t(
              "↑/↓ select · Tab/Enter insert only · Esc returns to the shell. Press Enter in the terminal to run.",
            )}
          </Text>
        ) : null}
      </div>
    </>
  );
}
