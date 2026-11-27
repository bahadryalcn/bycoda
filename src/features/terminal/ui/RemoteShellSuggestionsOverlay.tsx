import { useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { localTerminalPrefix } from "../model/localTerminalCompletion";
import { isTerminalTextEdit } from "../model/terminalKeys";
import type { SshShellController } from "../model/sshShellIntegration";
import { RemoteShellSuggestions } from "./RemoteShellSuggestions";
import { TerminalCursorPopover } from "./TerminalCursorPopover";

/** A typed edit whose echo never arrives (echo off, a stalled link) closes the list. */
const ECHO_GRACE_MS = 1000;

export function RemoteShellSuggestionsOverlay({
  shell,
  terminal,
  selectionMode,
  onClose,
}: {
  shell: SshShellController;
  terminal: Terminal;
  selectionMode: boolean;
  onClose: () => void;
}) {
  const [alternate, setAlternate] = useState(() => terminal.buffer.active.type === "alternate");
  // The echoed prefix at the prompt, read from xterm's own buffer; null when none.
  const [typed, setTyped] = useState<string | null>(null);
  // Typed edits so far, and how many there were when the list last closed. A
  // dismissal bumps the shell's preview epoch: the list then stays closed until
  // the owner types again.
  const [edits, setEdits] = useState(0);
  const [closed, setClosed] = useState({ epoch: shell.previewEpoch, edits: 0 });
  if (closed.epoch !== shell.previewEpoch) setClosed({ epoch: shell.previewEpoch, edits });
  const armed = edits > closed.edits;
  // Typed but not yet echoed: the list stays mounted, but accepting would use
  // the previous prefix, so completion keys pass through to the shell.
  const stale = useRef(false);
  const passive = !selectionMode && shell.automatic;

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Hide suggestions when the xterm buffer switches to a TUI.
  useEffect(() => {
    const sync = () => setAlternate(terminal.buffer.active.type === "alternate");
    sync();
    const subscription = terminal.buffer.onBufferChange(sync);
    return () => subscription.dispose();
  }, [terminal]);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Follow the echoed prefix so only this list changes while the owner types.
  useEffect(() => {
    if (!passive) return;
    let echoTimer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      clearTimeout(echoTimer);
      stale.current = false;
      setTyped(localTerminalPrefix(terminal));
    };
    sync();
    const parsed = terminal.onWriteParsed(sync);
    const input = terminal.onData((data) => {
      clearTimeout(echoTimer);
      if (!isTerminalTextEdit(data)) {
        // Enter, history keys and control chords belong to the shell; the next
        // echoed prompt line decides what is shown.
        stale.current = false;
        setTyped(null);
        return;
      }
      stale.current = true;
      setEdits((count) => count + 1);
      echoTimer = setTimeout(() => {
        stale.current = false;
        setTyped(null);
      }, ECHO_GRACE_MS);
    });
    return () => {
      clearTimeout(echoTimer);
      parsed.dispose();
      input.dispose();
      stale.current = false;
      setTyped(null);
    };
  }, [terminal, passive]);

  const matches = passive && typed && armed ? shell.catalogMatches(typed) : [];
  const preview = typed && matches.length ? { prefix: typed, suggestions: matches } : undefined;
  const hasLiveSuggestions =
    shell.state?.status === "suggestions" && !!shell.state.suggestions?.length;
  if (alternate || (!selectionMode && !(shell.automatic && (hasLiveSuggestions || preview))))
    return null;

  return (
    <TerminalCursorPopover
      terminal={terminal}
      onDismiss={() => {
        shell.dismiss();
        onClose();
      }}
    >
      <RemoteShellSuggestions
        shell={shell}
        terminal={terminal}
        preview={preview}
        canAcceptPreview={() => !stale.current && localTerminalPrefix(terminal) === typed}
        selectionMode={selectionMode}
        onClose={onClose}
      />
    </TerminalCursorPopover>
  );
}
