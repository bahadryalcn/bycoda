import {
  resolveWorkspaceContext,
  workspaceOperationKey,
  workspaceRequest,
} from "../../../features/workspaces/model/workspaceClient";
import type { Dispatch, SetStateAction } from "react";
import {
  type SessionSummary,
  upsertSession,
  getSession,
  flushSessionWrites,
  shouldPersistSession,
} from "../../../features/sessions/data/sessionStore";
import {
  orchestrator,
  orchestrationProjectCwd,
  orchestrationCheckoutCwd,
  workspaceIdentity,
} from "../../../features/orchestration/model/orchestration";
import { sessionsRef, setSessions } from "../../../features/sessions/model/sessionsStore";
import {
  listWorktrees,
  removeOrchestrationWorktree,
  detachSessionWorktree,
} from "../../../features/source-control/model/worktrees";
import { pathKey } from "../../../shared/lib/paths";
import { invoke } from "@tauri-apps/api/core";
import { sameProjectPath } from "../../../features/projects/model/recents";
import { newSession, sessionWorkCwd } from "../../../features/sessions/model/session";
import { mergeModelSettings, resolveModel } from "../../../features/sessions/model/models";
import {
  bindHarnessSession,
  stopHarnessSession,
  forgetHarnessSession,
} from "../../../integrations/harness";
import { sessionChildHarnesses } from "../../../features/sessions/model/handoff";
import {
  flushSessionCheckpoint,
  sessionCheckpointCleanupSafe,
  forgetSessionCheckpoint,
  notifyReviewChanged,
} from "../../../features/sessions/model/checkpoint";

export interface OrchestratorWorkerBindingDeps {
  checkOpenWorktreeFiles: (path: string) => void;
  onStop: (sessionId: string, managed?: boolean) => void;
  setHistory: Dispatch<SetStateAction<SessionSummary[]>>;
  setStoredLinkedSessions: Dispatch<SetStateAction<SessionSummary[]>>;
}

type OrchestratorBindingConfig = Parameters<typeof orchestrator.bind>[0];

export function createOrchestratorWorkerBindings({
  checkOpenWorktreeFiles,
  onStop,
  setHistory,
  setStoredLinkedSessions,
}: OrchestratorWorkerBindingDeps): Pick<
  OrchestratorBindingConfig,
  "createWorker" | "integrateWorker" | "cleanupWorker"
> {
  return {
    createWorker: async (run, task) => {
      const projectCwd = orchestrationProjectCwd(run);
      const leadCheckoutCwd = orchestrationCheckoutCwd(run);
      const lead = sessionsRef.current.find((session) => session.id === run.leadId);
      if (!lead) throw new Error("Lead session is unavailable");
      const workspace =
        task.workspacePolicy === "shared"
          ? workspaceIdentity(projectCwd, leadCheckoutCwd)
          : task.workspace
            ? await listWorktrees(leadCheckoutCwd).then((listed) => {
                const tree = listed.worktrees.find(
                  (entry) => pathKey(entry.path) === pathKey(task.workspace!.checkoutCwd),
                );
                if (!tree)
                  throw new Error(
                    "This worker's retained worktree is missing. Its saved changes cannot be retried automatically.",
                  );
                return {
                  ...workspaceIdentity(
                    projectCwd,
                    tree.path,
                    tree.branch ?? task.workspace!.branch,
                  ),
                  managedWorkspaceId: task.workspace!.managedWorkspaceId,
                };
              })
            : await (async () => {
                const context = await resolveWorkspaceContext(projectCwd);
                const { workspace: managed } = await workspaceRequest(
                  "workspaces.prepare",
                  {
                    idempotencyKey: `orchestration:${task.sessionId}:workspace`,
                    projectId: context.projectId,
                    environmentId: context.environmentId,
                    owner: { kind: "session", id: task.sessionId },
                    slug: task.title,
                    choice: { defaultMode: "worktree" },
                  },
                  { cwd: projectCwd },
                );
                if (
                  managed.owner.kind !== "session" ||
                  managed.owner.id !== task.sessionId ||
                  managed.directoryState !== "present"
                )
                  throw new Error(
                    "Worker workspace preparation is incomplete; retry the same assignment",
                  );
                return {
                  ...workspaceIdentity(
                    projectCwd,
                    managed.path,
                    managed.branchRef.replace(/^refs\/heads\//, ""),
                  ),
                  managedWorkspaceId: managed.id,
                };
              })();
      const checkoutCwd = workspace.checkoutCwd;
      const scratchDir = await invoke<string>("control_attach_worker", {
        leadId: run.leadId,
        sessionId: task.sessionId,
      });
      const existing = sessionsRef.current.find((session) => session.id === task.sessionId);
      if (existing) {
        if (
          existing.harness !== task.harness ||
          existing.model !== task.model ||
          !sameProjectPath(existing.cwd, projectCwd) ||
          (!existing.worktreeRemoved && !sameProjectPath(sessionWorkCwd(existing), checkoutCwd))
        )
          throw new Error(
            "This worker's configuration changed. Restore its approved harness, model and project before retrying.",
          );
        // The lead's runtime mode governs its agents, including across a
        // change mid-run: auto stays auto, supervised asks the lead.
        const synced = {
          ...existing,
          cwd: projectCwd,
          worktreeCwd: sameProjectPath(projectCwd, checkoutCwd) ? undefined : checkoutCwd,
          branch: workspace.branch,
          workspaceId: workspace.managedWorkspaceId,
          worktreeRemoved: false,
          runtimeMode: lead.runtimeMode,
          orchestrationLeadId: run.leadId,
        };
        await upsertSession(synced);
        const next = sessionsRef.current.map((session) =>
          session.id === synced.id ? synced : session,
        );
        sessionsRef.current = next;
        setSessions(next);
        return { scratchDir, workspace };
      }
      const restored = await getSession(task.sessionId);
      if (restored && (restored.harness !== task.harness || restored.model !== task.model))
        throw new Error(
          "The saved worker no longer matches its approved model. Create a new assignment.",
        );
      const fresh = {
        ...newSession(task.harness, projectCwd, task.model, lead.runtimeMode),
        ...(sameProjectPath(projectCwd, checkoutCwd)
          ? {}
          : {
              worktreeCwd: checkoutCwd,
              branch: workspace.branch,
              workspaceId: workspace.managedWorkspaceId,
            }),
        ...(task.modelSettings
          ? {
              modelSettings: mergeModelSettings(
                resolveModel(task.harness, task.model),
                task.modelSettings,
              ),
            }
          : {}),
      };
      const base = restored
        ? {
            ...restored,
            busy: false,
            cwd: projectCwd,
            worktreeCwd: sameProjectPath(projectCwd, checkoutCwd) ? undefined : checkoutCwd,
            branch: sameProjectPath(projectCwd, checkoutCwd) ? undefined : workspace.branch,
            workspaceId: workspace.managedWorkspaceId,
            worktreeRemoved: false,
            runtimeMode: lead.runtimeMode,
          }
        : {
            ...fresh,
            id: task.sessionId,
            title: task.title,
          };
      const worker = { ...base, orchestrationLeadId: run.leadId };
      if (worker.providerSessionId)
        bindHarnessSession(
          worker.harness,
          worker.id,
          worker.providerSessionId,
          sessionWorkCwd(worker),
          worker.providerAccountId,
          worker.blocks,
        );
      await upsertSession(worker);
      const next = [...sessionsRef.current, worker];
      sessionsRef.current = next;
      setSessions(next);
      // Workers belong to the lead's agent panel; no workspace tab is created.
      return { scratchDir, workspace };
    },
    integrateWorker: async (run, task) => {
      const fromCwd = task.workspace?.checkoutCwd;
      if (!fromCwd) throw new Error("This worker's isolated checkout is unavailable");
      const session = sessionsRef.current.find((entry) => entry.id === task.sessionId);
      if (session)
        await Promise.all(
          sessionChildHarnesses(session).map((harness) =>
            stopHarnessSession(harness, task.sessionId),
          ),
        );
      await invoke("harness_kill", { sessionId: task.sessionId });
      await invoke("control_turn_finished", { sessionId: task.sessionId });
      await flushSessionCheckpoint(task.sessionId);
      const workspaceId = task.workspace?.managedWorkspaceId;
      if (!workspaceId)
        throw new Error(
          "This legacy worker needs explicit owner migration and owner-approved managed delivery; its checkout and branch were retained",
        );
      let managed = await workspaceRequest(
        "workspaces.get",
        { workspaceId },
        { cwd: orchestrationProjectCwd(run) },
      );
      if (
        !managed ||
        managed.owner.kind !== "session" ||
        managed.owner.id !== task.sessionId ||
        !sameProjectPath(managed.path, fromCwd)
      )
        throw new Error("Worker workspace identity changed; its result was not accepted");
      if (managed.state !== "merged") {
        if (managed.state !== "finished")
          managed = await workspaceRequest(
            "workspaces.finish",
            {
              workspaceId,
              expectedRevision: managed.revision,
              idempotencyKey: workspaceOperationKey(),
            },
            { cwd: orchestrationProjectCwd(run) },
          );
        throw new Error(
          "This committed worker result requires owner-approved managed delivery. Open the worker's Workspace actions, review and merge its branch, then retry review.",
        );
      }
      const delivery = await workspaceRequest(
        "workspaces.delivery.review",
        { workspaceId, expectedRevision: managed.revision, action: "merge" },
        { cwd: orchestrationProjectCwd(run) },
      );
      if (delivery.blockers.length || delivery.commits.length)
        throw new Error(
          "The worker branch changed after owner-approved managed delivery; request a fresh owner review before acceptance",
        );
      // A committed branch naturally has a different HEAD from the lead.
      // Only the Host's owner-approved delivery state permits acceptance.
      return { files: [], alreadyApplied: 0 };
    },
    cleanupWorker: async (run, task, onlyIfUnchanged) => {
      const workspace = task.workspace;
      if (!workspace || workspace.kind !== "worktree") return true;
      const path = workspace.checkoutCwd;
      if (workspace.managedWorkspaceId) {
        const context = { cwd: orchestrationProjectCwd(run) };
        let current = await workspaceRequest(
          "workspaces.get",
          { workspaceId: workspace.managedWorkspaceId },
          context,
        );
        if (!current) throw new Error("Worker workspace registry is unavailable");
        if (current.directoryState === "removed") return true;
        if (onlyIfUnchanged) {
          const untouched = await workspaceRequest(
            "workspaces.cleanup.plan",
            { workspaceId: current.id, expectedRevision: current.revision },
            context,
          );
          if (untouched.dirty || untouched.head !== current.baseCommit || untouched.blockers.length)
            return false;
          current = await workspaceRequest(
            "workspaces.close",
            {
              workspaceId: current.id,
              expectedRevision: current.revision,
              idempotencyKey: workspaceOperationKey(),
            },
            context,
          );
        } else if (current.state !== "merged") return false;
        checkOpenWorktreeFiles(current.path);
        const plan = await workspaceRequest(
          "workspaces.cleanup.plan",
          { workspaceId: current.id, expectedRevision: current.revision },
          context,
        );
        await workspaceRequest(
          "workspaces.cleanup.apply",
          {
            workspaceId: current.id,
            expectedRevision: current.revision,
            idempotencyKey: workspaceOperationKey(),
            planToken: plan.token,
          },
          context,
        );
        const detach = <T extends { id: string; worktreeRemoved?: boolean }>(session: T): T =>
          session.id === task.sessionId ? { ...session, worktreeRemoved: true } : session;
        sessionsRef.current = sessionsRef.current.map(detach);
        setSessions(sessionsRef.current);
        setHistory((sessions) => sessions.map(detach));
        setStoredLinkedSessions((sessions) => sessions.map(detach));
        const retained = sessionsRef.current.find((session) => session.id === task.sessionId);
        if (retained && shouldPersistSession(retained)) await upsertSession(retained);
        await forgetSessionCheckpoint(task.sessionId);
        notifyReviewChanged(task.sessionId);
        return true;
      }
      await flushSessionCheckpoint(task.sessionId);
      const listed = await listWorktrees(orchestrationCheckoutCwd(run));
      const exists = listed.worktrees.some((tree) => pathKey(tree.path) === pathKey(path));
      if (!exists && onlyIfUnchanged) return false;
      const workerTree = listed.worktrees.find((tree) => pathKey(tree.path) === pathKey(path));
      const leadTree = listed.worktrees.find((tree) =>
        sameProjectPath(tree.path, orchestrationCheckoutCwd(run)),
      );
      if (exists && (!workerTree || !leadTree || workerTree.head !== leadTree.head)) {
        if (onlyIfUnchanged) return false;
        throw new Error(
          "The worker or lead branch moved before cleanup. The worker worktree was kept for manual review.",
        );
      }
      if (onlyIfUnchanged) {
        const safe = await sessionCheckpointCleanupSafe(task.sessionId, path);
        if (!safe) return false;
      } else if (exists) {
        // Re-verify immediately before destructive cleanup. The operation is
        // idempotent, so this also finishes a partially applied integration.
        throw new Error(
          "Legacy worker cleanup requires explicit owner migration; the branch and checkout were retained",
        );
      }

      if (exists) {
        onStop(task.sessionId, true);
        const session = sessionsRef.current.find((entry) => entry.id === task.sessionId);
        if (session) {
          await Promise.all(
            sessionChildHarnesses(session).map((harness) =>
              stopHarnessSession(harness, task.sessionId),
            ),
          );
        }
        await invoke("harness_kill", { sessionId: task.sessionId });
        await invoke("control_turn_finished", {
          sessionId: task.sessionId,
        });
        await flushSessionWrites();
        checkOpenWorktreeFiles(path);
        const removed = await removeOrchestrationWorktree(orchestrationCheckoutCwd(run), path);
        const affected = new Set([task.sessionId, ...removed.sessionIds]);
        sessionsRef.current = sessionsRef.current.map((session) =>
          affected.has(session.id)
            ? detachSessionWorktree(session, removed.projectCwd, path)
            : session,
        );
        setSessions(sessionsRef.current);
        const detachSummary = (entry: SessionSummary) =>
          affected.has(entry.id) ? detachSessionWorktree(entry, removed.projectCwd, path) : entry;
        setHistory((current) => current.map(detachSummary));
        setStoredLinkedSessions((current) => current.map(detachSummary));
        if (session)
          await Promise.allSettled(
            sessionChildHarnesses(session).map((harness) =>
              forgetHarnessSession(harness, task.sessionId),
            ),
          );
      } else {
        const detached = sessionsRef.current.find((entry) => entry.id === task.sessionId);
        if (detached && !detached.worktreeRemoved) {
          const next = detachSessionWorktree(detached, orchestrationProjectCwd(run), path);
          sessionsRef.current = sessionsRef.current.map((entry) =>
            entry.id === task.sessionId ? next : entry,
          );
          setSessions(sessionsRef.current);
          if (shouldPersistSession(next)) await upsertSession(next);
        }
      }
      // Directory cleanup always retains the branch, including absent-directory retries.
      await forgetSessionCheckpoint(task.sessionId);
      notifyReviewChanged(task.sessionId);
      return true;
    },
  };
}
