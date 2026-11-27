import type { Session } from "../../sessions";
import {
  ApprovalDecisionProvider,
  ActivityRow,
  ComposerQuestionForm,
  SubagentChatComposer,
} from "../../sessions/public/delegatedRequests";
import { InlineError } from "../../../shared/ui/InlineError";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { remoteSessionFor, useRemoteMachines } from "../model/connections";
import { remoteProjectFor } from "../model/remoteProjects";
import { hostExecutionProject, hostSessionBinding } from "../model/sessionExecutionBinding";
import { isLocalSyncMachine } from "../model/localSync";
import { desktopCopyOf } from "../model/adoptedSessions";
import { sameProjectPath } from "../../projects/public/recents";
import { setSessions } from "../../sessions/public/sessionsStore";
import { RemoteSession } from "./RemoteSession";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import type { HostSession } from "../model/protocol";

/** Mounts the existing Host owner for a child; requests stay in the parent sheet.
 * A background owner (`renderRequests` false) keeps its notices out of the pane. */
export function DelegatedSessionRequests(props: Parameters<typeof SessionRequests>[0]) {
  const content = <SessionRequests {...props} />;
  return props.renderRequests === false ? <div hidden>{content}</div> : content;
}

function SessionRequests({
  child,
  visible,
  renderRequests = true,
  composer,
  onOpenFile,
  onOpenDiff,
}: {
  child: Session;
  visible: boolean;
  renderRequests?: boolean;
  /** Only the selected child renders the standard composer from its Host connection. */
  composer?: { name: string; parentSessionId?: string };
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  const t = useT();
  const owner = hostSessionBinding(child);
  const project = owner ? hostExecutionProject(child) : remoteProjectFor(child.cwd);
  const { machines, loaded } = useRemoteMachines(!!project);
  const matches = machines.filter(
    (machine) =>
      machine.environmentId === project?.environmentId &&
      (!owner || (machine.id === owner.machineId && isLocalSyncMachine(machine))),
  );
  const valid =
    !!project &&
    (owner
      ? !!owner.projectId && owner.sessionId === child.id && matches.length === 1
      : remoteSessionFor(child.id) === child.id && matches.length === 1);
  const onSnapshot = useStableCallback((id: string, snapshot?: HostSession) => {
    // The sheet reads child.blocks outside this owner's render; keep its reader current.
    // Host remains the writer, and a disconnect retains the last received content.
    if (!snapshot || id !== child.id || snapshot.session.id !== child.id) return;
    setSessions((sessions) =>
      sessions.map((session) =>
        session.id === id
          ? {
              ...session,
              ...desktopCopyOf(snapshot, session.cwd, sameProjectPath),
              busy: false,
              pendingQuestion: snapshot.session.pendingQuestion,
              submittedQuestions: snapshot.session.submittedQuestions,
              historyPartial: snapshot.history?.before !== undefined,
              historyLoading: snapshot.historyLoading,
            }
          : session,
      ),
    );
  });
  if (!valid)
    return (
      <InlineError>
        {loaded
          ? t("This local conversation is unavailable or inaccessible.")
          : t("Connecting to the machine…")}
      </InlineError>
    );
  return (
    <RemoteSession
      compactPresentation
      shell={child}
      visible={visible}
      onSnapshot={onSnapshot}
      onOpenFile={onOpenFile ?? (() => {})}
      onOpenDiff={(path) => {
        if (path) onOpenDiff?.(path);
      }}
      onOpenPlan={() => {}}
      render={(remote) => {
        if (!renderRequests) return null;
        const session = remote.session;
        const onApproval = remote.onApproval;
        const onQuestionReply = remote.onQuestionReply;
        const onSubmit = remote.onSubmit;
        if (!session) return null;
        const approvals = session.blocks.filter(
          (block) => block.approval && !block.approval.decided,
        );
        const requests =
          onApproval && onQuestionReply ? (
            <ApprovalDecisionProvider session={session} dispatch={onApproval}>
              {remote.remoteHistoryHasMore ? (
                <Button
                  variant="ghost"
                  loading={remote.remoteHistoryLoading}
                  onClick={() =>
                    void Promise.resolve(remote.onLoadRemoteHistory?.()).catch(() => {})
                  }
                >
                  {t("Load earlier messages")}
                </Button>
              ) : null}
              {remote.remoteHistoryError ? (
                <InlineError details={remote.remoteHistoryError}>
                  {t("Could not load older messages.")}
                </InlineError>
              ) : null}
              {approvals.map((block) => (
                <ActivityRow
                  key={block.id}
                  block={block}
                  cwd={session.cwd}
                  live
                  onOpenFile={onOpenFile}
                  onOpenDiff={onOpenDiff}
                  onApproval={(requestId, decision) => onApproval(session.id, requestId, decision)}
                />
              ))}
              {session.pendingQuestion ? (
                <ComposerQuestionForm
                  question={session.pendingQuestion}
                  draftScope={session.id}
                  sessionId={session.id}
                  remote
                  remoteFeatures={remote.remoteFeatures}
                  onReply={(requestId, reply) => onQuestionReply(session.id, requestId, reply)}
                />
              ) : null}
            </ApprovalDecisionProvider>
          ) : null;
        return (
          <>
            {requests}
            {composer && visible && onSubmit ? (
              <SubagentChatComposer
                name={composer.name}
                parentSessionId={composer.parentSessionId}
                session={session}
                visible={visible}
                remoteSession
                remoteFeatures={remote.remoteFeatures}
                sendBlockedReason={remote.sendBlockedReason}
                onSubmit={(text, attachments, options) =>
                  onSubmit(session.id, text, attachments, options)
                }
                onStop={remote.onStop ? () => remote.onStop?.(session.id) : undefined}
                onOpenFile={remote.onOpenFile}
                onDeleteQueuedMessage={
                  remote.onDeleteQueuedMessage
                    ? (id) => remote.onDeleteQueuedMessage?.(session.id, id)
                    : undefined
                }
                onEditQueuedMessage={
                  remote.onEditQueuedMessage
                    ? (id, text, attachments) =>
                        remote.onEditQueuedMessage?.(session.id, id, text, attachments)
                    : undefined
                }
                onQueuedMessageEditingChange={
                  remote.onQueuedMessageEditingChange
                    ? (id) => remote.onQueuedMessageEditingChange?.(session.id, id)
                    : undefined
                }
                onReorderQueuedMessages={
                  remote.onReorderQueuedMessages
                    ? (ids) => remote.onReorderQueuedMessages?.(session.id, ids)
                    : undefined
                }
                onSteerQueuedMessage={
                  remote.onSteerQueuedMessage
                    ? (id) => remote.onSteerQueuedMessage?.(session.id, id)
                    : undefined
                }
                onResumeQueue={
                  remote.onResumeQueue ? () => remote.onResumeQueue?.(session.id) : undefined
                }
              />
            ) : null}
          </>
        );
      }}
    />
  );
}
