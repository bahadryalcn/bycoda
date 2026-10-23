import { memo, type ComponentProps, type Dispatch, type SetStateAction } from "react";
import { useStableHandlers } from "../../../shared/hooks/useStableHandlers";
import { useHeldValue } from "../helpers/stableProps";
import { SessionRecoveryPanel } from "../../shell/SessionRecoveryPanel";
import { WhatsNewDialog } from "../../shell/WhatsNewDialog";
import {
  DeleteSessionDialog,
  type SessionDeleteChoice,
} from "../../../features/sessions/ui/DeleteSessionDialog";
import { ClaudeSessionPicker } from "../../../features/sessions/ui/ClaudeSessionPicker";
import type { ClaudeImportTarget } from "../../../features/sessions/model/claudeSessionImport";
import type { ClaudeSessionSummary } from "../../../platform/tauri/fs";
import { ProviderSignInDialog } from "../../../features/sessions/ui/ProviderSignInDialog";
import { ProviderAccountRecoveryDialog } from "../../../features/sessions/ui/ProviderAccountRecoveryDialog";
import { GitFileInspector } from "../../../features/source-control/ui/GitFileInspector";
import { SessionImportHost } from "../../../features/sessions/ui/SessionImportHost";
import { OnboardingHost } from "../../../features/onboarding/ui/OnboardingHost";
import { AddRemoteProjectDialog } from "../../../features/connections/ui/AddRemoteProjectDialog";
import { ProjectNameConflictDialog } from "../../../features/projects/ui/ProjectNameConflictDialog";
import {
  projectNameError,
  type AutoNamedProject,
} from "../../../features/projects/model/projectNames";
import { remoteProjectFor } from "../../../features/connections/model/remoteProjects";
import { projectKey } from "../../../shared/lib/paths";
import { saveTabGroupLabel } from "../../../features/workspace/model/tabGroups";
import {
  supportsProviderAccounts,
  type ProviderAccountProvider,
} from "../../../features/providers/model/providerAccounts";
import {
  clearCachedRateLimits,
  loadRateLimits,
} from "../../../features/providers/model/rateLimitsCache";
import type { HarnessId } from "../../../features/sessions/model/session";
import type { SettingsAnchor } from "../../../features/settings/ui/SettingsView";
import type { SettingsSectionId } from "../../../features/settings/model/settings";

type RecoveryPanelProps = ComponentProps<typeof SessionRecoveryPanel>;

export type SessionDeleteDialogState = {
  title: string;
  unusedWorktree: string;
  resolve: (choice: SessionDeleteChoice) => void;
};

export interface WorkspaceRecoveryDialogsProps {
  recoveryOpen: boolean;
  sessionRecovery: RecoveryPanelProps["recovery"] | null | undefined;
  sessions: RecoveryPanelProps["sessions"];
  remoteSessions: RecoveryPanelProps["remoteSessions"];
  closeRecovery: RecoveryPanelProps["onClose"];
  openRecoveredSessions: RecoveryPanelProps["onOpen"];
  removeRecoveredSessions: RecoveryPanelProps["onRemove"];
  sessionDeleteDialog: SessionDeleteDialogState | undefined;
  setSessionDeleteDialog: Dispatch<SetStateAction<SessionDeleteDialogState | undefined>>;
}

function WorkspaceRecoveryDialogsComponent({
  recoveryOpen,
  sessionRecovery,
  sessions,
  remoteSessions,
  closeRecovery,
  openRecoveredSessions,
  removeRecoveredSessions,
  sessionDeleteDialog,
  setSessionDeleteDialog,
}: WorkspaceRecoveryDialogsProps) {
  return (
    <>
      {recoveryOpen && sessionRecovery ? (
        <SessionRecoveryPanel
          recovery={sessionRecovery}
          sessions={sessions}
          remoteSessions={remoteSessions}
          onClose={closeRecovery}
          onOpen={openRecoveredSessions}
          onRemove={removeRecoveredSessions}
        />
      ) : null}
      {sessionDeleteDialog && (
        <DeleteSessionDialog
          title={sessionDeleteDialog.title}
          unusedWorktree={sessionDeleteDialog.unusedWorktree}
          onClose={(choice) => {
            sessionDeleteDialog.resolve(choice);
            setSessionDeleteDialog(undefined);
          }}
        />
      )}
    </>
  );
}

export interface WorkspacePickerDialogsProps {
  resumePickerFor: ClaudeImportTarget | null;
  setResumePickerFor: Dispatch<SetStateAction<ClaudeImportTarget | null>>;
  importClaudeConversation: (target: ClaudeImportTarget, summary: ClaudeSessionSummary) => unknown;
  whatsNewVersion: string | null;
  setWhatsNewVersion: Dispatch<SetStateAction<string | null>>;
  onOpenCommit: ComponentProps<typeof GitFileInspector>["onOpenCommit"];
  onSessionsImported: () => void;
  onboardingContext: ComponentProps<typeof OnboardingHost>["context"];
  onSelectProject: ComponentProps<typeof OnboardingHost>["onOpenProject"];
  projectCwd: string;
  remoteProjectDialogOpen: boolean;
  setRemoteProjectDialogOpen: Dispatch<SetStateAction<boolean>>;
  nameConflicts: AutoNamedProject[];
  setNameConflicts: Dispatch<SetStateAction<AutoNamedProject[]>>;
  providerAccountRecovery: { sessionId: string; provider: ProviderAccountProvider } | null;
  setProviderAccountRecovery: Dispatch<
    SetStateAction<{ sessionId: string; provider: ProviderAccountProvider } | null>
  >;
  onSwitchSessionAccount: (
    sessionId: string,
    provider: ProviderAccountProvider,
    accountId: string,
  ) => Promise<boolean>;
  openSettings: (section?: SettingsSectionId, anchor?: SettingsAnchor) => void;
  providerSignInRequest: {
    key: string;
    sessionId: string;
    harness: HarnessId;
    accountId?: string;
  } | null;
  setProviderSignInRequest: Dispatch<
    SetStateAction<{
      key: string;
      sessionId: string;
      harness: HarnessId;
      accountId?: string;
    } | null>
  >;
}

function WorkspacePickerDialogsComponent({
  resumePickerFor,
  setResumePickerFor,
  importClaudeConversation,
  whatsNewVersion,
  setWhatsNewVersion,
  onOpenCommit,
  onSessionsImported,
  onboardingContext,
  onSelectProject,
  projectCwd,
  remoteProjectDialogOpen,
  setRemoteProjectDialogOpen,
  nameConflicts,
  setNameConflicts,
  providerAccountRecovery,
  setProviderAccountRecovery,
  onSwitchSessionAccount,
  openSettings,
  providerSignInRequest,
  setProviderSignInRequest,
}: WorkspacePickerDialogsProps) {
  return (
    <>
      {resumePickerFor ? (
        <ClaudeSessionPicker
          cwd={resumePickerFor.cwd}
          providerAccountId={resumePickerFor.providerAccountId}
          onClose={() => setResumePickerFor(null)}
          onPick={(summary) => {
            void importClaudeConversation(resumePickerFor, summary);
            setResumePickerFor(null);
          }}
        />
      ) : null}
      {whatsNewVersion ? (
        <WhatsNewDialog version={whatsNewVersion} onClose={() => setWhatsNewVersion(null)} />
      ) : null}
      <GitFileInspector onOpenCommit={onOpenCommit} />
      <SessionImportHost onImported={onSessionsImported} />
      <OnboardingHost
        context={onboardingContext}
        onImported={onSessionsImported}
        onOpenProject={onSelectProject}
        projectCwd={projectCwd}
      />
      {remoteProjectDialogOpen ? (
        <AddRemoteProjectDialog
          onCancel={() => setRemoteProjectDialogOpen(false)}
          onOpen={(key) => {
            setRemoteProjectDialogOpen(false);
            onSelectProject(key);
          }}
        />
      ) : null}
      {nameConflicts[0] ? (
        <ProjectNameConflictDialog
          key={nameConflicts[0].path}
          name={nameConflicts[0].name}
          path={remoteProjectFor(nameConflicts[0].path)?.cwd ?? nameConflicts[0].path}
          suggested={nameConflicts[0].suggested}
          validate={(name) => projectNameError(nameConflicts[0].path, name)}
          onConfirm={(name) => {
            saveTabGroupLabel(projectKey(nameConflicts[0].path), name);
            setNameConflicts((prev) => prev.slice(1));
          }}
          onCancel={() => setNameConflicts((prev) => prev.slice(1))}
        />
      ) : null}
      {providerAccountRecovery ? (
        <ProviderAccountRecoveryDialog
          key={providerAccountRecovery.sessionId}
          provider={providerAccountRecovery.provider}
          onSelect={(accountId) =>
            onSwitchSessionAccount(
              providerAccountRecovery.sessionId,
              providerAccountRecovery.provider,
              accountId,
            )
          }
          onClose={() => setProviderAccountRecovery(null)}
          onManage={() => {
            setProviderAccountRecovery(null);
            openSettings("providers", "provider-accounts");
          }}
        />
      ) : null}
      {providerSignInRequest ? (
        <ProviderSignInDialog
          key={providerSignInRequest.key}
          harness={providerSignInRequest.harness}
          accountId={providerSignInRequest.accountId}
          onSignedIn={() => {
            const { harness, accountId } = providerSignInRequest;
            if (!accountId || !supportsProviderAccounts(harness)) return;
            clearCachedRateLimits(harness, accountId);
            void loadRateLimits(harness, accountId, true);
          }}
          onClose={() => setProviderSignInRequest(null)}
        />
      ) : null}
    </>
  );
}

const MemoRecoveryDialogs = memo(WorkspaceRecoveryDialogsComponent);

/** The session lists only matter while recovery is open; holding them while it is
 * closed lets the memo skip the workspace's session updates. */
export function WorkspaceRecoveryDialogs(props: WorkspaceRecoveryDialogsProps) {
  const open = props.recoveryOpen && !!props.sessionRecovery;
  const sessions = useHeldValue(props.sessions, open);
  const remoteSessions = useHeldValue(props.remoteSessions, open);
  return <MemoRecoveryDialogs {...useStableHandlers({ ...props, sessions, remoteSessions })} />;
}

const MemoPickerDialogs = memo(WorkspacePickerDialogsComponent);

/** Workspace recreates most handlers per render; stable proxies let the memo hold. */
export function WorkspacePickerDialogs(props: WorkspacePickerDialogsProps) {
  return <MemoPickerDialogs {...useStableHandlers(props)} />;
}
