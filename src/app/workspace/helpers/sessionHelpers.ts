import { cachedRemoteSessionSummary, remoteSessionFor } from "../../../features/connections/model/connections";
import { noteCardMeta, type NoteComposerCard } from "../../../features/notes";
import { isRemoteProjectPath } from "../../../features/projects/model/recents";
import { planComposerSwitch, withHarnessChoice } from "../../../features/sessions/model/handoff";
import { mergeModelSettings, resolveModel } from "../../../features/sessions/model/models";
import { sessionDisplayTitle, type PlanBuildTarget, type PlanStatus, type SecondOpinionMeta, type Session } from "../../../features/sessions/model/session";
import { focusedFileTab, isCommitTab, isFilesystemTab, leafIds, type WorkspaceTab } from "../../../features/workspace/model/layout";
import { type GitFileDiffKind } from "../../../platform/tauri/fs";
import { displayPath } from "../../../shared/lib/paths";

export function withPlanStatus(session: Session, blockId: string, status: PlanStatus): Session {
  return {
    ...session,
    blocks: session.blocks.map((block) =>
      block.id === blockId && block.role === "plan"
        ? {
            ...block,
            plan: { ...(block.plan ?? { status: "ready" }), status },
          }
        : block,
    ),
  };
}

export function lastAssistantTextInTurn(session: Session): string {
  for (let index = session.blocks.length - 1; index >= 0; index -= 1) {
    const block = session.blocks[index];
    if (block.role === "user") return "";
    if (block.role === "assistant" && block.text.trim()) return block.text;
  }
  return "";
}

export function userTurnCards(noteCard: NoteComposerCard | undefined, secondOpinion?: SecondOpinionMeta) {
  if (!noteCard && !secondOpinion) return undefined;
  return {
    ...(secondOpinion ? { secondOpinion } : {}),
    ...(noteCard ? { noteCard: noteCardMeta(noteCard) } : {}),
  };
}

export function withPlanBuildTarget(session: Session, target: PlanBuildTarget): Session {
  const resolved = resolveModel(target.harness, target.model);
  const modelSettings = mergeModelSettings(resolved, target.modelSettings);
  const plan = planComposerSwitch(session, target.harness);
  const next = withHarnessChoice(session, target.harness, resolved.id, modelSettings);

  if (plan.kind === "arm") {
    return { ...next, pendingSwitch: plan.pending };
  }
  if (plan.kind === "revert") {
    return {
      ...next,
      pendingSwitch: undefined,
      ...(plan.restoreProviderSessionId
        ? { providerSessionId: plan.restoreProviderSessionId }
        : { providerSessionId: undefined }),
      ...(plan.restoreProviderAccountId
        ? { providerAccountId: plan.restoreProviderAccountId }
        : { providerAccountId: undefined }),
    };
  }
  if (plan.kind === "empty") {
    return { ...next, pendingSwitch: undefined };
  }
  return next;
}

export function openSessionIds(tabs: WorkspaceTab[]): Set<string> {
  const ids = new Set<string>();
  for (const tab of tabs) {
    for (const id of leafIds(tab.layout)) ids.add(id);
  }
  return ids;
}

export function conversationTitle(session: Session): string {
  const hostId = isRemoteProjectPath(session.cwd) ? remoteSessionFor(session.id) : undefined;
  const remote = hostId ? cachedRemoteSessionSummary(session.cwd, hostId) : undefined;
  const title = sessionDisplayTitle(
    remote?.title ?? session.title,
    remote?.harness ?? session.harness,
  );
  return title === "New session" ? "" : title;
}

export function lastUserBlockId(session: Session): string | undefined {
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    if (session.blocks[i]?.role === "user") return session.blocks[i]?.id;
  }
  return undefined;
}

export function providerSignInRequestKey(session: Session): string {
  const lastBlockId = session.blocks[session.blocks.length - 1]?.id;
  return `${session.id}:${lastUserBlockId(session) ?? lastBlockId ?? "auth"}`;
}

export function selectedChangePath(tab: WorkspaceTab, gitCwd?: string): string | undefined {
  const file = focusedFileTab(tab);
  if (!file || !isFilesystemTab(file) || !file.review) return undefined;
  return displayPath(file.path, gitCwd || file.cwd);
}

export function selectedChangeKind(tab: WorkspaceTab): GitFileDiffKind | undefined {
  const file = focusedFileTab(tab);
  return file?.review ? file.changeKind : undefined;
}

export function selectedCommitSha(tab: WorkspaceTab): string | undefined {
  const focused = focusedFileTab(tab);
  if (focused && isCommitTab(focused)) return focused.commit.sha;
  for (const pane of tab.editorPanes) {
    const file = pane.files.find((entry) => entry.id === pane.activeFileId);
    if (file && isCommitTab(file)) return file.commit.sha;
  }
}
