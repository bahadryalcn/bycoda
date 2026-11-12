import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { useT } from "../../../shared/i18n";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AgentTranscript } from "./AgentTranscript";
import { TranscriptFind } from "./TranscriptFind";
import {
  clearTranscriptJump,
  peekTranscriptJump,
  subscribeTranscriptJump,
} from "../model/transcriptJump";
import { HarnessIcon } from "./HarnessIcon";
import { findModel, subscribeModels } from "../model/models";
import { usePaneSession } from "../model/sessionsStore";
import { PresentationVisibility } from "./presentationVisibility";
import { HARNESS_TITLE, sessionDisplayTitle, sessionWorkCwd, type Session } from "../model/session";
import { createNote, noteTitle } from "../../notes";
import { loadNotesEnabled, subscribeNotesEnabled } from "../../settings/public/settings";
import { useHostSessionBinding } from "../../connections/public/useHostSessionBinding";
import { useCitedTurnHistory } from "./useCitedTurnHistory";
import { useReadOnlyHostSession } from "./useReadOnlyHostSession";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";

type AgentTabViewProps = {
  title: string;
  session?: Session;
  visible: boolean;
  focused?: boolean;
  onOpenFile?: (path: string) => void;
};

export function AgentTabView(props: AgentTabViewProps) {
  const hostBinding = useHostSessionBinding(props.session);
  // A hidden tab must not run its text-reveal frame loop.
  return (
    <PresentationVisibility.Provider value={props.visible}>
      {props.session && hostBinding ? (
        <HostAgentTabView {...props} session={props.session} />
      ) : (
        <LocalAgentTabView {...props} />
      )}
    </PresentationVisibility.Provider>
  );
}

function HostAgentTabView(props: AgentTabViewProps & { session: Session }) {
  const t = useT();
  const remote = useReadOnlyHostSession(props.session, props.visible);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {remote.error && (
        <Alert tone="danger">
          {remote.error}
          <Button type="button" variant="secondary" onClick={remote.retry}>
            {t("Retry")}
          </Button>
        </Alert>
      )}
      <div className="min-h-0 flex-1">
        <LocalAgentTabView {...props} {...remote} remoteSession />
      </div>
    </div>
  );
}

type HostHistoryProps = ReturnType<typeof useReadOnlyHostSession> & { remoteSession?: boolean };

/**
 * One orchestration worker, watched from its lead's workspace.
 *
 * Read-only on purpose: the run belongs to the orchestrator, which decides
 * what each worker is asked and when. A composer here would put a second
 * voice into a conversation the lead is holding, so the way to change course
 * is to say so in the lead's own transcript.
 */
function LocalAgentTabView({
  title,
  session: shellSession,
  visible,
  focused = visible,
  onOpenFile,
  remoteSession = false,
  remoteHistoryHasMore = false,
  remoteHistoryLoading = false,
  remoteHistoryError,
  onLoadRemoteHistory,
  onLoadRemoteBlock,
}: AgentTabViewProps & Partial<HostHistoryProps>) {
  const t = useT();
  // The shell's copy lags behind by streamed text; the store has the live one.
  // A hidden tab follows the shell and skips streamed frames.
  const live = usePaneSession(shellSession?.id, visible);
  const session = remoteSession ? shellSession : (live ?? shellSession);
  const navigateBlockRef = useRef<((blockId: string | null, query?: string) => boolean) | null>(
    null,
  );
  const [navigatorReady, setNavigatorReady] = useState(false);
  const [findTriggerContainer, setFindTriggerContainer] = useState<HTMLSpanElement | null>(null);
  const onNavigateReady = useCallback(
    (navigate: ((blockId: string | null, query?: string) => boolean) | null) => {
      navigateBlockRef.current = navigate;
      setNavigatorReady(navigate !== null);
    },
    [],
  );
  const navigateBlock = useCallback(
    (blockId: string | null, query?: string) => navigateBlockRef.current?.(blockId, query) ?? false,
    [],
  );
  const jumpRequest = useSyncExternalStore(
    subscribeTranscriptJump,
    () => peekTranscriptJump(session?.id ?? ""),
    () => null,
  );
  useCitedTurnHistory({
    visible,
    jump: jumpRequest,
    blocks: session?.blocks ?? [],
    hasMore: remoteHistoryHasMore,
    loading: remoteHistoryLoading,
    error: remoteHistoryError,
    load: onLoadRemoteHistory,
  });
  useEffect(() => {
    if (!visible || !navigatorReady || !session || !jumpRequest) return;
    const frame = requestAnimationFrame(() => {
      if (navigateBlock(jumpRequest.blockId, jumpRequest.query)) {
        clearTranscriptJump(session.id, jumpRequest.token);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, navigatorReady, jumpRequest, navigateBlock, session?.id, session?.blocks]);
  const notesEnabled = useSyncExternalStore(subscribeNotesEnabled, loadNotesEnabled, () => true);
  const saveNote = async (text: string) => {
    if (!session) return;
    const sessionTitle = sessionDisplayTitle(session.title, session.harness);
    await createNote({
      title: sessionTitle && sessionTitle !== "New session" ? sessionTitle : noteTitle(text),
      body: text,
      sourceSessionId: session.id,
      sourceCwd: session.cwd,
    });
  };
  const saveSelectionNote = async (text: string) => {
    if (!session) return;
    await createNote({
      title: noteTitle(text),
      body: text,
      sourceSessionId: session.id,
      sourceCwd: session.cwd,
    });
  };
  // The model catalog can change while the tab is open; the name follows it.
  const modelName = useSyncExternalStore(subscribeModels, () =>
    session ? findModel(session.model)?.name : undefined,
  );
  if (!session) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <Text as="p" tone="secondary" leading="relaxed" className="max-w-sm">
          {t(
            "This agent is no longer running. Its work is summarised in the orchestrator's conversation.",
          )}
        </Text>
      </div>
    );
  }
  const model = modelName ?? session.model;
  return (
    <div data-agent-tab className="flex h-full min-h-0 flex-col">
      <div className="@container relative min-h-0 flex-1">
        <AgentTranscript
          blocks={session.blocks}
          busy={session.busy}
          historyLoading={session.historyLoading}
          historyLoadError={session.historyLoadError}
          remoteHistoryHasMore={remoteHistoryHasMore}
          remoteHistoryLoading={remoteHistoryLoading}
          remoteHistoryError={remoteHistoryError}
          onLoadRemoteHistory={onLoadRemoteHistory}
          onLoadRemoteBlock={onLoadRemoteBlock}
          cwd={sessionWorkCwd(session)}
          harness={session.harness}
          model={session.model}
          modelSettings={session.modelSettings}
          providerAccountId={session.providerAccountId}
          visible={visible}
          onOpenFile={onOpenFile}
          onSaveNote={notesEnabled ? saveNote : undefined}
          onSaveSelectionNote={notesEnabled ? saveSelectionNote : undefined}
          onNavigateReady={onNavigateReady}
          managed
        />
        <TranscriptFind
          sessionId={session.id}
          blocks={session.blocks}
          visible={visible}
          focused={focused}
          onNavigate={navigateBlock}
          triggerContainer={findTriggerContainer}
        />
      </div>
      <Text
        as="footer"
        size="micro"
        tone="secondary"
        {...surfaceAttributes(
          { frame: "neutral", edge: "top" },
          "flex shrink-0 items-center gap-1.5  border-(--ui-tone-neutral-border) px-3 py-1.5 font-sans",
        )}
      >
        <HarnessIcon harness={session.harness} className="size-3.5 shrink-0" />
        <Text size="inherit" tone="inherit" truncate className="min-w-0" title={title}>
          {model} · {HARNESS_TITLE[session.harness]}
        </Text>
        <span className="ml-auto shrink-0">{t("Run by the orchestrator · read-only")}</span>
        <span ref={setFindTriggerContainer} className="shrink-0" />
      </Text>
    </div>
  );
}
