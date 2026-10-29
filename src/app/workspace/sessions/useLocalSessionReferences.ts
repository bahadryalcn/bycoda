import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { getGroupLockView, subscribeGroupLock } from "../../../features/group-lock/model/groupLock";
import { getSessions, setSessions } from "../../../features/sessions/model/sessionsStore";
import { getSession } from "../../../features/sessions/data/sessionStore";
import {
  assertReferenceProjectVisible,
  resolveLocalSessionReference,
  type ResolvedLocalSession,
} from "../../../features/sessions/model/localSessionNavigation";
import {
  hostSessionBinding,
  hostSessionShellSummaries,
  restoreHostSessionShell,
  saveHostSessionBinding,
  patchHostSessionShellMetadata,
} from "../../../features/connections/model/sessionExecutionBinding";
import {
  loadRemoteBlock,
  sessionAccessForMachine,
} from "../../../features/connections/model/connections";
import { sessionExecutionClient } from "../../../features/connections/model/sessionExecutionClient";
import { newDefaultSession, type Session } from "../../../features/sessions/model/session";
import { requestTranscriptJump } from "../../../features/sessions/model/transcriptJump";
import type { LocalSessionReferenceNavigation } from "../../../features/sessions/ui/LocalSessionReferenceContext";
import { t } from "../../../shared/i18n";

type Deps = {
  ensureOpenSession: (id: string) => Promise<Session | null>;
  onSelectHistorySession: (id: string) => Promise<unknown>;
  onOpenSessionsSideBySide: (ids: string[]) => Promise<unknown>;
  activeSessionId: () => string | undefined;
  showSessions: () => void;
  workspaceNavigation: { cancel: () => void; captureRequest?: () => () => boolean };
};

/** Ambient adapter shared by transcript, Notes and every document Markdown consumer. */
export function useLocalSessionReferences(deps: Deps) {
  const current = useRef(deps);
  current.current = deps;
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const privacy = useSyncExternalStore(subscribeGroupLock, getGroupLockView);
  return useMemo(
    () =>
      ({
        resolve: async (reference) => {
          const target = await resolveLocalSessionReference(reference);
          return {
            title: target.title,
            project: target.cwd,
            archived: target.archived,
            origin: target.locator.kind === "host" ? t("Local Host") : t("Local Native"),
            status: target.status
              ? t(
                  (
                    { idle: "Idle", running: "Running", interrupted: "Interrupted" } as Record<
                      string,
                      string
                    >
                  )[target.status] ?? target.status,
                )
              : t("Status unavailable"),
          };
        },
        open: async (reference, options) => {
          const serial = ++request.current;
          const owner = current.current;
          owner.workspaceNavigation.cancel();
          const navigationCurrent = owner.workspaceNavigation.captureRequest?.() ?? (() => true);
          const stillCurrent = () =>
            serial === request.current && getGroupLockView() === privacy && navigationCurrent();
          const target = await resolveLocalSessionReference(reference);
          if (!stillCurrent()) return;
          assertReferenceProjectVisible(target.cwd);
          let id = target.locator.sessionId;
          // The legacy UI namespace uses bare IDs. A persisted Host display shell at
          // this ID cannot stand in for a different Native conversation.
          if (!target.host && hostSessionBinding({ id }))
            throw new Error(t("This local conversation is unavailable or inaccessible."));
          if (target.host) {
            const { machine, snapshot } = target.host;
            if (reference.turnId) {
              // Validate the cited block without guessing a title or substituting another turn.
              const block = await loadRemoteBlock(
                machine.id,
                target.locator.sessionId,
                reference.turnId,
                snapshot.revision,
                sessionExecutionClient(
                  machine.environmentId,
                  sessionAccessForMachine(machine.id, false, true, machine.environmentId),
                ),
              ).catch(() => {
                throw new Error(
                  t(
                    "The cited turn is unavailable. Open the conversation without the turn reference.",
                  ),
                );
              });
              if (!stillCurrent()) return;
              if (!block || block.role !== "user" || block.internal || block.draft)
                throw new Error(
                  t(
                    "The cited turn is unavailable. Open the conversation without the turn reference.",
                  ),
                );
            }
            const visited = new Set<string>();
            const displayShell = async (resolved: ResolvedLocalSession): Promise<string | null> => {
              const host = resolved.host;
              if (!host || !stillCurrent()) return null;
              const canonicalId = resolved.locator.sessionId;
              if (visited.has(canonicalId) || visited.size >= 8)
                throw new Error(t("This local conversation is unavailable or inaccessible."));
              visited.add(canonicalId);
              let leadId: string | undefined;
              const canonicalLead = host.snapshot.session.orchestrationLeadId;
              if (canonicalLead && canonicalLead !== canonicalId) {
                const lead = await resolveLocalSessionReference({
                  locator: {
                    kind: "host",
                    environmentId: host.machine.environmentId,
                    sessionId: canonicalLead,
                  },
                });
                leadId = (await displayShell(lead)) ?? undefined;
                if (!stillCurrent()) return null;
              }
              const shells = [
                ...getSessions(),
                ...hostSessionShellSummaries().flatMap((summary) => {
                  const shell = restoreHostSessionShell(summary.id);
                  return shell ? [shell] : [];
                }),
              ];
              const existing = shells.find((shell) => {
                const binding = hostSessionBinding(shell);
                return (
                  binding?.environmentId === host.machine.environmentId &&
                  binding.sessionId === canonicalId
                );
              });
              if (existing) {
                if (existing.orchestrationLeadId !== leadId) {
                  const next = saveHostSessionBinding(
                    { ...existing, orchestrationLeadId: leadId },
                    hostSessionBinding(existing)!,
                  );
                  setSessions((sessions) =>
                    sessions.map((entry) =>
                      entry.id === existing.id
                        ? { ...entry, orchestrationLeadId: next.orchestrationLeadId }
                        : entry,
                    ),
                  );
                }
                return existing.id;
              }
              assertReferenceProjectVisible(resolved.cwd);
              const shell = saveHostSessionBinding(
                {
                  ...newDefaultSession(host.project.cwd),
                  title: resolved.title,
                  ...(leadId ? { orchestrationLeadId: leadId } : {}),
                },
                {
                  kind: "local-host",
                  machineId: host.machine.id,
                  environmentId: host.machine.environmentId,
                  projectId: host.project.id,
                  sessionId: canonicalId,
                  authorityGeneration: host.snapshot.authorityGeneration ?? null,
                  created: true,
                },
              );
              patchHostSessionShellMetadata(shell.id, { archived: resolved.archived });
              // Display binding only; Native authoritative history/archive is never changed.
              setSessions((sessions) => [...sessions, shell]);
              return shell.id;
            };
            const shellId = await displayShell(target);
            if (!shellId || !stillCurrent()) return;
            id = shellId;
          } else if (reference.turnId) {
            const session = await getSession(id);
            if (!stillCurrent()) return;
            if (
              !session?.blocks.some(
                (block) =>
                  block.id === reference.turnId &&
                  block.role === "user" &&
                  !block.internal &&
                  !block.draft,
              )
            )
              throw new Error(
                t(
                  "The cited turn is unavailable. Open the conversation without the turn reference.",
                ),
              );
          }
          const session = await owner.ensureOpenSession(id);
          if (!stillCurrent()) return;
          if (!session || session.inboxAsk)
            throw new Error(t("This local conversation is unavailable or inaccessible."));
          if (!target.host && hostSessionBinding(session))
            throw new Error(t("This local conversation is unavailable or inaccessible."));
          assertReferenceProjectVisible(target.cwd);
          const source = owner.activeSessionId();
          owner.showSessions();
          const opening =
            options?.beside && source && source !== id
              ? owner.onOpenSessionsSideBySide([source, id])
              : owner.onSelectHistorySession(id);
          const delegatedCurrent = owner.workspaceNavigation.captureRequest?.() ?? (() => true);
          await opening;
          if (
            reference.turnId &&
            serial === request.current &&
            getGroupLockView() === privacy &&
            delegatedCurrent()
          )
            requestTranscriptJump(id, reference.turnId);
        },
      }) satisfies LocalSessionReferenceNavigation,
    [privacy],
  );
}
