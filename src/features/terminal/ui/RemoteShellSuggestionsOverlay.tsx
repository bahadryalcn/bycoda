import { useEffect, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { localTerminalPrefix } from "../model/localTerminalCompletion";
import type { SshShellController } from "../model/sshShellIntegration";
import { RemoteShellSuggestions } from "./RemoteShellSuggestions";
import { TerminalCursorPopover } from "./TerminalCursorPopover";

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
  // undefined: not measured yet; null: the prompt line cannot be read.
  const [promptPrefix, setPromptPrefix] = useState<string | null>();
  const retaining = !!shell.preview && !selectionMode;

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Hide suggestions when the xterm buffer switches to a TUI.
  useEffect(() => {
    const sync = () => setAlternate(terminal.buffer.active.type === "alternate");
    sync();
    const subscription = terminal.buffer.onBufferChange(sync);
    return () => subscription.dispose();
  }, [terminal]);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Narrow the display-only list as xterm echoes edits between native snapshots.
  useEffect(() => {
    if (!retaining) return;
    const sync = () => setPromptPrefix(localTerminalPrefix(terminal));
    sync();
    const subscription = terminal.onWriteParsed(sync);
    return () => {
      subscription.dispose();
      setPromptPrefix(undefined);
    };
  }, [terminal, retaining]);

  const shownPrefix = promptPrefix === undefined ? shell.preview?.prefix : promptPrefix;
  const preview =
    retaining && shell.preview && shownPrefix != null
      ? {
          prefix: shownPrefix,
          suggestions: shell.preview.suggestions.filter(
            (value) => value.startsWith(shownPrefix) && value !== shownPrefix,
          ),
        }
      : undefined;
  const hasLiveSuggestions =
    shell.state?.status === "suggestions" && !!shell.state.suggestions?.length;
  if (
    alternate ||
    (!selectionMode && !(shell.automatic && (hasLiveSuggestions || preview?.suggestions.length)))
  )
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
        selectionMode={selectionMode}
        onClose={onClose}
      />
    </TerminalCursorPopover>
  );
}
