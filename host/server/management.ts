import { sessionWorkCwd } from "../../src/features/sessions/model/session";
import { conversationGitReviewHash } from "../conversation/conversation-git-review";
import {
  ConversationManagementRuntime,
  isRuntimeManagementAction,
} from "../conversation/conversation-management-runtime";
import {
  ConversationManagementTools,
  managementCommand,
  managementPage,
  pageDesktopManagementSnapshot,
  type GlobalManagementPrincipal,
  type ManagementAction,
  type ManagementReceipt,
} from "../conversation/conversation-management-tools";
import {
  projectManagementPath,
  runConversationGitAction,
} from "../conversation/conversation-project-management";
import {
  dispatchSessionManagement,
  isSessionManagementAction,
} from "../conversation/conversation-session-management";
import { ConversationThreadCrewTools } from "../conversation/conversation-thread-crew-tools";
import { ConversationThreadWorkTools } from "../conversation/conversation-thread-work-tools";
import {
  dispatchWorkspaceManagement,
  isWorkspaceManagementAction,
} from "../conversation/conversation-workspace-management";
import { assistantModelPoolSource } from "../conversation/conversation-model-pool-source";
import { type HostDomainContext } from "../domains/context";
import type { ServerBindings } from "./bindings";
export function createManagementRuntime(
  dependencies: Pick<
    ServerBindings,
    | "conversationDesktop"
    | "engine"
    | "visibleProjectForThread"
    | "tasks"
    | "goals"
    | "automations"
    | "crews"
    | "assistant"
    | "projectSessionList"
    | "environmentService"
    | "persistenceService"
    | "tunnels"
    | "mobileLan"
    | "mobileAccess"
    | "featureSession"
    | "commandService"
    | "workspaceForOwnerRpc"
    | "managed"
    | "managedWorkspaces"
    | "featureClaims"
    | "projectsService"
    | "workspacePolicy"
    | "sprints"
    | "sprintsService"
    | "gitService"
  >,
) {
  const approveManagementOperation = async (
    operation: {
      action: string;
      input: Record<string, unknown>;
      operationHash: string;
    },
    principal: import("../execution/runtime-log-tools").RuntimeLogSubjectPrincipal,
    authorized: () => Promise<boolean>,
  ) => {
    const decision = (await dependencies.conversationDesktop.call(
      "management.write.authorize",
      { operation },
      (await dependencies.engine.store.project(principal.projectId)).cwd,
      principal,
      authorized,
    )) as { approved?: boolean; operationHash?: string };
    if (
      decision.approved &&
      principal.kind === "assistant-thread" &&
      !(await dependencies.visibleProjectForThread(
        principal.projectId,
        principal.threadId,
        authorized,
      ))
    )
      throw new Error("The target project became unavailable or locked during review.");
    return decision;
  };
  const modelPool = assistantModelPoolSource(dependencies.assistant);
  const conversationThreadWork = new ConversationThreadWorkTools(
    dependencies.engine.store,
    dependencies.tasks,
    dependencies.goals,
    dependencies.automations,
    approveManagementOperation,
    modelPool,
  );
  const conversationThreadCrews = new ConversationThreadCrewTools(
    dependencies.crews,
    {
      approve: approveManagementOperation,
      receipt: async (key) => {
        const row = await dependencies.engine.store.db
          .prepare("SELECT value FROM metadata WHERE key=?")
          .get(key);
        return row ? (JSON.parse(String(row.value)) as ManagementReceipt) : undefined;
      },
      saveReceipt: async (key, value) => {
        await dependencies.engine.store.db
          .prepare(
            "INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          )
          .run(key, JSON.stringify(value));
      },
    },
    modelPool,
  );
  const conversationManagementRuntime = new ConversationManagementRuntime({
    subscribe: (listener) => dependencies.engine.store.subscribeChanges(listener),
    snapshot: async (projectId) => {
      const sessions = (await dependencies.projectSessionList(projectId)).list
        .slice(0, 100)
        .map((row) => ({
          kind: "session",
          id: row.id,
          status: row.status,
          needsInput: row.needsInput,
          updatedAt: row.updatedAt,
        }));
      const taskRows = (await dependencies.tasks.list())
        .filter((row) => row.projectId === projectId)
        .slice(0, 100)
        .map((row) => ({
          kind: "task",
          id: row.id,
          status: row.status,
          updatedAt: row.updatedAt,
        }));
      const goalRows = (await dependencies.goals.list())
        .filter((row) => row.projectIds.length === 1 && row.projectIds[0] === projectId)
        .slice(0, 100)
        .map((row) => ({
          kind: "goal",
          id: row.id,
          status: row.status,
          updatedAt: row.updatedAt,
        }));
      return [...sessions, ...taskRows, ...goalRows].sort(
        (a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
      );
    },
    read: async (action, args, principal, authorized) => {
      const context: HostDomainContext = { authorized };
      if (action === "environment.describe") return dependencies.environmentService.describe({});
      if (action === "environment.persistence.status")
        return dependencies.persistenceService.status({}, context);
      if (action === "sync.status") {
        const row = (await dependencies.engine.store.db
          .prepare("SELECT value FROM metadata WHERE key='syncRev'")
          .get()) as { value: string } | undefined;
        const revision = row ? Number(row.value) : null;
        return {
          revision: Number.isSafeInteger(revision) ? revision : null,
          available: Number.isSafeInteger(revision),
          state: "host-sync-metadata",
        };
      }
      if (action === "tunnels.status") return dependencies.tunnels.status();
      if (action === "mobile.access.status")
        return args.mode === "lan"
          ? dependencies.mobileLan.status()
          : dependencies.mobileAccess.status();
      if (action === "history.import.status") {
        if (principal.kind !== "session")
          throw new Error("Choose a real focused session for history import status.");
        const own = await dependencies.featureSession(principal.sessionId);
        if (own.projectId !== principal.projectId)
          throw new Error("Conversation belongs to another project.");
        const cwd = sessionWorkCwd(own.session);
        return dependencies.conversationDesktop.call(
          "historyImport.status",
          {
            ...args,
            sessionId: principal.sessionId,
          },
          cwd,
          principal,
          authorized,
        );
      }
      throw new Error("Unsupported runtime management action.");
    },
  });
  const conversationManagement = new ConversationManagementTools({
    receipt: async (key) => {
      const row = (await dependencies.engine.store.db
        .prepare("SELECT value FROM metadata WHERE key=?")
        .get(key)) as { value: string } | undefined;
      return row ? (JSON.parse(row.value) as ManagementReceipt) : undefined;
    },
    saveReceipt: async (key, value) => {
      await dependencies.engine.store.db
        .prepare(
          "INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, JSON.stringify(value));
    },
    approve: approveManagementOperation,
    execute: async (action, args, principal, authorized) => {
      if (isRuntimeManagementAction(action))
        return conversationManagementRuntime.call(action, args, principal, authorized);
      const projectId = principal.projectId,
        environmentId = dependencies.engine.store.environmentId;
      const project = await dependencies.engine.store.project(projectId);
      const context: HostDomainContext = {
        authorized,
        principalId: `management:${principal.kind === "assistant-thread" ? principal.threadId : principal.sessionId}`,
      };
      const checkSession = async (id: unknown) => {
        const value = await dependencies.featureSession(String(id));
        if (value.projectId !== projectId)
          throw new Error("Conversation belongs to another project.");
        return value;
      };
      const cwd =
        principal.kind === "session"
          ? sessionWorkCwd((await checkSession(principal.sessionId)).session)
          : project.cwd;
      if (isSessionManagementAction(action))
        return dispatchSessionManagement(action, args, principal, authorized, {
          session: dependencies.featureSession,
          preview: (input, source) => dependencies.engine.previewContextual(input, source),
          dispatch: (command) => dependencies.commandService.dispatch(command, context),
          modelPool,
        });
      if (isWorkspaceManagementAction(action))
        return dispatchWorkspaceManagement(action, args, principal, authorized, {
          environmentId,
          ownerProject: async (owner) =>
            owner.kind === "session"
              ? (await dependencies.featureSession(owner.id)).projectId
              : owner.kind === "task"
                ? (await dependencies.tasks.get(owner.id))?.projectId
                : undefined,
          workspace: dependencies.workspaceForOwnerRpc,
          assertWritable: (id) => dependencies.managed.assertWritable(id),
          registry: dependencies.managedWorkspaces,
          featureClaims: dependencies.featureClaims,
          removal: dependencies.managed.removal,
          delivery: dependencies.managed.delivery,
          reviewTaskDelivery: (id) => dependencies.tasks.reviewDelivery(id),
        });
      if (action === "projects.get")
        return {
          id: project.id,
          name: project.name,
          cwd: project.cwd,
          environmentId,
        };
      if (["projects.browse", "projects.createDirectory", "projects.open"].includes(action)) {
        const path = await projectManagementPath(project.cwd, args.path);
        if (action === "projects.open")
          return dependencies.projectsService.open({ cwd: path }, context);
        const listing =
          action === "projects.createDirectory"
            ? await dependencies.projectsService.createDirectory({ path, name: args.name }, context)
            : await dependencies.projectsService.browse({ path }, context);
        return { path: listing.path, ...managementPage(listing.entries, args) };
      }
      if (action === "projects.workspacePolicy.get")
        return dependencies.workspacePolicy.get({ projectId, environmentId });
      if (action === "workspaces.list")
        return managementPage(
          (
            await dependencies.managedWorkspaces.list({
              projectId,
              environmentId,
            })
          ).filter((row) => row.projectId === projectId),
          args,
        );
      if (action === "workspaces.featureClaims.list")
        return managementPage(
          (await dependencies.featureClaims.list({ projectId })).filter(
            (row) => row.projectId === projectId,
          ),
          args,
        );
      if (action.startsWith("workspaces.")) {
        const value = await dependencies.workspaceForOwnerRpc(args.workspaceId);
        if (!value || value.projectId !== projectId)
          throw new Error("Workspace is not in this project.");
        if (action === "workspaces.get") return value;
        const request = {
          workspaceId: value.id,
          expectedRevision: Number(args.expectedRevision),
          idempotencyKey: String(args.requestId),
        };
        if (action === "workspaces.resume") return dependencies.managedWorkspaces.resume(request);
        if (action === "workspaces.finish") return dependencies.managedWorkspaces.finish(request);
        if (action === "workspaces.close") return dependencies.managedWorkspaces.close(request);
      }
      if (action.startsWith("sprints.")) {
        const scoped = (row: { projects: Array<{ projectId: string; environmentId: string }> }) =>
          row.projects.length > 0 &&
          row.projects.every(
            (ref) => ref.projectId === projectId && ref.environmentId === environmentId,
          );
        if (action === "sprints.list")
          return managementPage((await dependencies.sprints.list()).sprints.filter(scoped), args);
        if (action !== "sprints.create" && args.sprintId !== null) {
          const current = await dependencies.sprints.get(String(args.sprintId));
          if (!current || !scoped(current))
            throw new Error("Sprint is not wholly in this project.");
        }
        const { sprintId, requestId, ...fields } = args;
        const input = { ...fields, requestId };
        if (action === "sprints.get")
          return dependencies.sprintsService.get({ id: sprintId }, context);
        if (action === "sprints.report")
          return dependencies.sprintsService.report({ id: sprintId }, context);
        if (action === "sprints.create")
          return dependencies.sprintsService.create(
            {
              input: {
                ...input,
                id: sprintId,
                projects: [
                  {
                    environmentId,
                    projectId,
                    cwd: project.cwd,
                    name: project.name,
                  },
                ],
                capacityPoints: args.capacityPoints ?? null,
                projectCapacities: {},
              },
            },
            context,
          );
        if (action === "sprints.update")
          return dependencies.sprintsService.update({ id: sprintId, input }, context);
        if (action === "sprints.start")
          return dependencies.sprintsService.start({ id: sprintId, input }, context);
        if (action === "sprints.complete")
          return dependencies.sprintsService.complete({ id: sprintId, input }, context);
        if (action === "sprints.archive")
          return dependencies.sprintsService.archive({ id: sprintId, input }, context);
        if (action === "sprints.plan") {
          const task = await dependencies.tasks.get(String(args.taskId));
          if (!task || task.projectId !== projectId)
            throw new Error("Task is not in this project.");
          return dependencies.sprintsService.plan(
            { input: { ...input, sprintId, environmentId, projectId } },
            context,
          );
        }
      }
      if (action === "git.status") {
        const status = await dependencies.gitService.index({ projectId, cwd }, context);
        return {
          ...status,
          files: undefined,
          expectedStatus: await conversationGitReviewHash(cwd),
          ...managementPage(status.files, args),
        };
      }
      if (action === "git.stash" || action === "git.pull")
        return dependencies.gitService.managedAction(
          { projectId, cwd },
          context,
          (lockedCwd) => runConversationGitAction(lockedCwd, action, args),
          {
            beforeEffect: async (lockedCwd) => {
              if ((await conversationGitReviewHash(lockedCwd)) !== args.expectedStatus)
                throw new Error("Git status changed; read it and review again.");
            },
          },
        );
      if (action === "git.stage" || action === "git.unstage" || action === "git.commit") {
        if ((await conversationGitReviewHash(cwd)) !== args.expectedStatus)
          throw new Error("Git status changed; read it and review again.");
        return dependencies.gitService.action(
          {
            projectId,
            cwd,
            action:
              action === "git.commit"
                ? "commit"
                : action === "git.stage"
                  ? "stageFiles"
                  : "unstageFiles",
            ...(args.paths ? { path: args.paths } : {}),
            ...(args.message ? { message: args.message } : {}),
          },
          context,
          {
            beforeEffect: async (lockedCwd) => {
              if ((await conversationGitReviewHash(lockedCwd)) !== args.expectedStatus)
                throw new Error("Git status changed while waiting; review again.");
            },
          },
        );
      }
      if (
        action.startsWith("preferences.") ||
        action.startsWith("providers.") ||
        action.startsWith("projects.organization.")
      ) {
        const desktopAction = action.startsWith("projects.organization.")
          ? action.replace("projects.organization.", "organization.")
          : action === "providers.status"
            ? "providerManagement.read"
            : action === "providers.quota.refresh"
              ? "providerManagement.quotaRefresh"
              : action === "providers.operation.status"
                ? "providerManagement.status"
                : action;
        const {
          requestId,
          offset: _offset,
          limit: _limit,
          memberOffset: _memberOffset,
          ...fields
        } = args;
        if (principal.kind === "assistant-thread") {
          if (!action.startsWith("projects.organization."))
            throw new Error("Use the global assistant source for desktop settings.");
          const result = await dependencies.conversationDesktop.callAssistantThread(
            desktopAction,
            {
              ...fields,
              ...(requestId ? { operationId: requestId } : {}),
            },
            {
              threadId: principal.threadId,
              environmentId,
              projectId,
              targetProjectCwd: project.cwd,
            },
            authorized,
          );
          return pageDesktopManagementSnapshot(result, args);
        }
        const result = await dependencies.conversationDesktop.call(
          desktopAction,
          {
            ...fields,
            ...(requestId ? { operationId: requestId } : {}),
            sessionId: principal.sessionId,
          },
          cwd,
          principal,
          authorized,
        );
        return pageDesktopManagementSnapshot(result, args);
      }
      if (action === "commands.status") {
        await checkSession(args.sessionId);
        const receipt = await dependencies.commandService.status(
          { commandId: args.commandId },
          context,
        );
        if (receipt && receipt.sessionId !== args.sessionId)
          throw new Error("Command belongs to another conversation.");
        return receipt;
      }
      if (action === "commands.dispatch" || action === "ownerQuestions.answer") {
        const command =
          action === "commands.dispatch"
            ? (args.command as Record<string, unknown>)
            : {
                type: "answer",
                sessionId: args.sessionId,
                runId: args.runId,
                requestId: args.questionRequestId,
                reply: { kind: "answered", answers: args.answers },
              };
        await checkSession(command.sessionId);
        return dependencies.commandService.dispatch(
          managementCommand(command, String(args.requestId)),
          context,
        );
      }
      if (action === "ownerQuestions.list") {
        const rows = (await dependencies.projectSessionList(projectId)).list;
        const values = await Promise.all(
          rows
            .filter((row) => row.needsInput)
            .slice(0, 100)
            .map(async (row) => {
              const value = await checkSession(row.id);
              return {
                sessionId: row.id,
                title: row.title,
                runId: value.runId ?? null,
                question: value.session.pendingQuestion ?? null,
              };
            }),
        );
        return managementPage(
          values.filter((row) => row.question),
          args,
        );
      }
      if (action === "events.read") {
        const snapshot = await dependencies.projectSessionList(projectId);
        return {
          mode: "sampled" as const,
          durable: false,
          sampledAt: Date.now(),
          ...managementPage(
            snapshot.list
              .filter((row) => row.updatedAt > Number(args.after ?? 0))
              .map((row) => ({
                kind: "session-state",
                sessionId: row.id,
                status: row.status,
                needsInput: row.needsInput,
                updatedAt: row.updatedAt,
                lastActivityAt: row.runActivity?.lastActivityAt ?? row.lastActivityAt ?? null,
              })),
            args,
          ),
        };
      }
      throw new Error("Unsupported management action.");
    },
  });
  const globalAssistantManagement = new ConversationManagementTools<
    ManagementAction,
    GlobalManagementPrincipal
  >({
    receipt: async (key) => {
      const row = await dependencies.engine.store.db
        .prepare("SELECT value FROM metadata WHERE key=?")
        .get(key);
      return row ? (JSON.parse(String(row.value)) as ManagementReceipt) : undefined;
    },
    saveReceipt: async (key, value) => {
      await dependencies.engine.store.db
        .prepare(
          "INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, JSON.stringify(value));
    },
    approve: async (operation, principal, authorized) =>
      dependencies.conversationDesktop.callAssistantThread(
        "management.write.authorize",
        { operation },
        principal,
        authorized,
      ) as Promise<{ approved?: boolean; operationHash?: string }>,
    execute: async (action, args, principal, authorized) => {
      const desktopAction = action.startsWith("projects.organization.")
        ? action.replace("projects.organization.", "organization.")
        : action === "providers.status"
          ? "providerManagement.read"
          : action === "providers.quota.refresh"
            ? "providerManagement.quotaRefresh"
            : action === "providers.operation.status"
              ? "providerManagement.status"
              : action;
      const {
        requestId,
        offset: _offset,
        limit: _limit,
        memberOffset: _memberOffset,
        ...fields
      } = args;
      const value = await dependencies.conversationDesktop.callAssistantThread(
        desktopAction,
        {
          ...fields,
          ...(desktopAction === "organization.read"
            ? {
                ...(args.offset === undefined ? {} : { offset: args.offset }),
                ...(args.limit === undefined ? {} : { limit: args.limit }),
              }
            : {}),
          ...(requestId ? { operationId: requestId } : {}),
        },
        principal,
        authorized,
      );
      if (
        desktopAction === "organization.read" &&
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Array.isArray((value as Record<string, unknown>).items)
      ) {
        const known = await dependencies.engine.store.projects();
        const directory = value as Record<string, unknown>;
        directory.items = (directory.items as unknown[]).map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return item;
          const record = item as Record<string, unknown>;
          const matches = known.filter((project) => project.cwd === record.cwd);
          return matches.length === 1 ? { ...record, projectId: matches[0].id } : record;
        });
        if (!(await authorized())) throw new Error("Assistant thread authority revoked.");
      }
      return pageDesktopManagementSnapshot(value, args);
    },
  });
  const globalServerManagement = new ConversationManagementTools<string, GlobalManagementPrincipal>(
    {
      receipt: async (key) => {
        const row = await dependencies.engine.store.db
          .prepare("SELECT value FROM metadata WHERE key=?")
          .get(key);
        return row ? (JSON.parse(String(row.value)) as ManagementReceipt) : undefined;
      },
      saveReceipt: async (key, value) => {
        await dependencies.engine.store.db
          .prepare(
            "INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          )
          .run(key, JSON.stringify(value));
      },
      approve: async (operation, principal, authorized) =>
        dependencies.conversationDesktop.callAssistantThread(
          "management.write.authorize",
          { operation },
          principal,
          authorized,
        ) as Promise<{ approved?: boolean; operationHash?: string }>,
      execute: async (action, args, principal, authorized) => {
        const input = args.serverInput as Record<string, unknown>;
        const { operationId: _operationId, ...canonical } = input;
        return dependencies.conversationDesktop.callAssistantThread(
          action,
          canonical,
          principal,
          authorized,
        );
      },
    },
    new Set(),
  );
  return {
    approveManagementOperation,
    conversationThreadWork,
    conversationThreadCrews,
    conversationManagementRuntime,
    conversationManagement,
    globalAssistantManagement,
    globalServerManagement,
  };
}
