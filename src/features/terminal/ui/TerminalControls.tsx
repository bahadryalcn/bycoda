import { invoke } from "@tauri-apps/api/core";
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { loadServerSnippets } from "../../connections";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Modal } from "../../../shared/ui/Modal";
import { Text } from "../../../shared/ui/Text";
import { useSshShellIntegration, type SshShellController } from "../model/sshShellIntegration";
import { RemoteShellSuggestionsOverlay } from "./RemoteShellSuggestionsOverlay";
import { TerminalTools } from "./TerminalTools";

const ServerSnippets = lazy(() =>
  loadServerSnippets().then((module) => ({
    default: module.ServerSnippets,
  })),
);

export type TerminalShellActions = Pick<
  SshShellController,
  "invalidate" | "notifyInput" | "suspendAutomatic"
> & { requestCurrent: () => void };

type Props = Omit<
  ComponentProps<typeof TerminalTools>,
  "terminalId" | "remoteShell" | "onSavedCommands"
> & {
  id: string;
  integrated: boolean;
  autoIntegration: boolean;
  bindShellActions: (actions: TerminalShellActions | null) => void;
  sshConnectionId?: string;
  onSshPromptReady?: () => void;
  snippetsOpen: boolean;
  onSnippetsOpenChange: (open: boolean) => void;
};

/** Own SSH suggestion updates independently of the xterm/PTY view. */
export function TerminalControls({
  id,
  integrated,
  autoIntegration,
  bindShellActions,
  sshConnectionId,
  onSshPromptReady,
  onEnableShellIntegration,
  snippetsOpen,
  onSnippetsOpenChange,
  terminal,
  mode,
  onModeChange,
  ready,
  suggestionsAllowed,
  onStartupReview,
  fontSize,
  savedFontSize,
  onResetFontSize,
  onFontSizeChange,
  searchDecorations,
}: Props) {
  const t = useT();
  const shell = useSshShellIntegration(id, integrated);
  const {
    automatic,
    source,
    waiting,
    request,
    dismiss,
    setAutomatic,
    setSource,
    invalidate,
    notifyInput,
    suspendAutomatic,
  } = shell;

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keep xterm's imperative input handlers bound to the current shell actions.
  useLayoutEffect(() => {
    bindShellActions({
      invalidate,
      notifyInput,
      suspendAutomatic,
      requestCurrent: () => {
        void request(source);
      },
    });
    return () => bindShellActions(null);
  }, [bindShellActions, invalidate, notifyInput, suspendAutomatic, request, source]);

  const [reportedId, setReportedId] = useState<string>();
  const currentShellReported = integrated && shell.state?.id === id;
  // Keep the manual setup option stable through the gaps between native snapshots.
  const nextReportedId = !integrated ? undefined : currentShellReported ? id : reportedId;
  if (nextReportedId !== reportedId) setReportedId(nextReportedId);
  const promptedId = useRef<string | undefined>(undefined);
  const promptReady =
    currentShellReported && shell.state?.status === "ready" && shell.state.promptReady === true;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Notify the startup review owner once the native SSH prompt is ready.
  useEffect(() => {
    if (!promptReady || promptedId.current === id) return;
    promptedId.current = id;
    onSshPromptReady?.();
  }, [id, onSshPromptReady, promptReady]);

  const waitingForSelection = mode === "remote" && waiting;
  const remoteTools = integrated
    ? {
        automatic,
        source,
        waiting: waitingForSelection,
        request,
        dismiss,
        setAutomatic,
        setSource,
      }
    : undefined;
  const closeSnippets = () => {
    onSnippetsOpenChange(false);
    dismiss();
    terminal?.focus();
  };
  const snapshot = shell.state;
  const enableShellIntegration =
    !integrated || (autoIntegration && nextReportedId !== id)
      ? onEnableShellIntegration
      : undefined;
  return (
    <>
      <TerminalTools
        terminalId={id}
        terminal={terminal}
        mode={mode}
        onModeChange={onModeChange}
        ready={ready}
        suggestionsAllowed={suggestionsAllowed}
        remoteShell={remoteTools}
        onStartupReview={onStartupReview}
        onEnableShellIntegration={enableShellIntegration}
        onSavedCommands={
          integrated && sshConnectionId
            ? () => {
                onSnippetsOpenChange(true);
                void request();
              }
            : undefined
        }
        fontSize={fontSize}
        savedFontSize={savedFontSize}
        onResetFontSize={onResetFontSize}
        onFontSizeChange={onFontSizeChange}
        searchDecorations={searchDecorations}
      />
      {integrated && terminal && (mode === null || mode === "remote") ? (
        <RemoteShellSuggestionsOverlay
          shell={shell}
          terminal={terminal}
          selectionMode={mode === "remote"}
          onClose={() => {
            if (mode === "remote") onModeChange(null);
          }}
        />
      ) : null}
      {snippetsOpen && sshConnectionId ? (
        <Modal title={t("Saved SSH commands")} onClose={closeSnippets} fitViewport>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" loading={waiting} onClick={() => void request()}>
              {t("Refresh")}
            </Button>
            <Text size="caption" tone="muted">
              {(shell.error ? t(shell.error) : "") ||
                t("Insert commands at an empty shell prompt. Press Enter in the terminal to run.")}
            </Text>
          </div>
          <Suspense fallback={<LoadingText />}>
            <ServerSnippets
              embedded
              serverId={sshConnectionId}
              serverName={snapshot ? `${snapshot.user}@${snapshot.host}` : undefined}
              onInsert={
                snapshot?.status === "suggestions" && snapshot.prefix === ""
                  ? async (value) => {
                      if (!snapshot.requestId)
                        throw new Error("Request a fresh snapshot at an empty shell prompt");
                      await invoke("ssh_terminal_command_insert", {
                        id,
                        requestId: snapshot.requestId,
                        value,
                      });
                      closeSnippets();
                    }
                  : undefined
              }
            />
          </Suspense>
        </Modal>
      ) : null}
    </>
  );
}
