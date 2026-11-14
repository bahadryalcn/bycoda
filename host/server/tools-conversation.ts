import { createHash } from "node:crypto";
import { agentToolAllowedForChild } from "../delegation/tools";
import { dirname } from "node:path";
import { sessionConversationPage } from "../../src/features/agent-app/model/sessionConversation";
import type { DeviceAction } from "../../src/features/devices/types";
import type { DevServerDetails } from "../../src/features/host-tools/devServerTypes";
import { localSessionLinkFields } from "../../src/features/sessions/model/localSessionReference";
import { sessionWorkCwd } from "../../src/features/sessions/model/session";
import { conversationSessionPage } from "../../src/shared/model/conversationSessionPage";
import { isDesktopControlConversationTool } from "../conversation/conversation-desktop-control-tools";
import {
  callFileConversationTool,
  isFileConversationTool,
} from "../conversation/conversation-file-tools";
import { isGoalWriteTool } from "../conversation/conversation-goal-tools";
import { isSecretTool } from "../secrets/secret-schemas";
import { isPullRequestWatchTool } from "../pull-request-watch/pull-request-watch-tools";
import {
  conversationListArguments,
  pageConversationListResult,
} from "../conversation/conversation-list-page";
import { crewToolGate } from "../crews/crew-tools";
import { isManagementAction } from "../conversation/conversation-management-tools";
import {
  type ConversationPreviewInput,
  type PreviewBrowserState,
  type PreviewPresentation,
} from "../conversation/conversation-preview";
import { isProjectConversationTool } from "../conversation/conversation-project-tools";
import { isRuntimeReadConversationTool } from "../conversation/conversation-runtime-read-tools";
import { isStewardConversationTool } from "../conversation/conversation-steward-tools";
import { isTaskQueueTool } from "../conversation/conversation-task-queue-tools";
import {
  CONVERSATION_TASK_EXECUTION_DEFAULTS,
  TASK_READ_TOOLS,
  callConversationTaskRead,
  normalizeConversationTaskConfiguration,
} from "../conversation/conversation-task-tools";
import {
  sessionConversationToolCatalog,
  validateSessionConversationTool,
} from "../conversation/conversation-tools";
import {
  callVisualConversationTool,
  isVisualConversationTool,
} from "../conversation/conversation-visual-tools";
import {
  callImageConversationTool,
  isImageConversationTool,
} from "../conversation/conversation-image-tools";
import { isWorkspaceConversationTool } from "../conversation/conversation-workspace-tools";
import { openDevServerBrowser } from "../dev-servers/dev-server-browser";
import {
  RUNTIME_LOG_CONVERSATION_ACTIONS,
  callRuntimeLogAction,
} from "../execution/runtime-log-conversation";
import { scrubRuntimeLogText } from "../execution/runtime-logs";
import { resolveHostWorktreeAsync } from "../git/git-worktrees";
import { managedDiscoveryResult, managedMcpCatalog } from "../mcp/mcp-http";
import { readHarnessSkill, searchHarnessSkills } from "../skills/harness-skills";
import type { ServerBindings } from "./bindings";
import type { HttpToolRequest } from "./http-tool-context";
import { hostDegradedSince } from "./support";
import { handleAssistantThreadTools } from "./tools-assistant-thread";
export async function dispatchConversationTools(
  dependencies: Pick<
    ServerBindings,
    | "conversationAccess"
    | "engine"
    | "projectSessionList"
    | "localSessionReference"
    | "featureSession"
    | "assistant"
    | "roomNotebook"
    | "roomWorkspace"
    | "conversationThreadCrews"
    | "conversationThreadWork"
    | "conversationManagement"
    | "conversationDesktopControl"
    | "conversationWorkspace"
    | "conversationRuntimeReads"
    | "featureMeta"
    | "inHost"
    | "conversationDesktop"
    | "explicitSkillNames"
    | "crews"
    | "conversationStewards"
    | "conversationTaskQueue"
    | "conversationDelegation"
    | "conversationGoals"
    | "conversationSecrets"
    | "pullRequestWatchTools"
    | "conversationProject"
    | "browserRuntime"
    | "workspace"
    | "runtimeLogs"
    | "runtimeLogWaiter"
    | "refreshLogSources"
    | "logMonitors"
    | "deviceHost"
    | "devicePreviews"
    | "conversationPreviews"
    | "sharedBrowser"
    | "tasks"
    | "devServers"
    | "diagnostics"
  >,
  request: Pick<
    HttpToolRequest,
    | "conversationPrincipal"
    | "params"
    | "token"
    | "result"
    | "endResult"
    | "response"
    | "tokenHash"
    | "voiceBrowserOwner"
  >,
) {
  if (!request.conversationPrincipal)
    throw new Error("A scoped conversation credential is required.");
  const boundPrincipal = request.conversationPrincipal;
  if (boundPrincipal.kind === "assistant-thread")
    return await handleAssistantThreadTools(dependencies, { boundPrincipal, request });
  return await dependencies.engine.store.db.withAuthorization(
    dependencies.conversationAccess.authorization(request.token),
    async () => {
      const action = String(request.params.action ?? "");
      const originalArgs = request.params.input as Record<string, unknown>;
      validateSessionConversationTool(action, originalArgs);
      const crewAllows = await crewToolGate(dependencies, boundPrincipal, action);
      const args = conversationListArguments(action, originalArgs);
      const scopedDeviceAuthorized = async () => {
        const current = await dependencies.conversationAccess.principalForToken(request.token);
        return (
          !!current &&
          current.sessionId === boundPrincipal.sessionId &&
          current.projectId === boundPrincipal.projectId
        );
      };
      const scopedDeviceEffect = { authorized: scopedDeviceAuthorized };
      const projectId = boundPrincipal.projectId;
      const project = await dependencies.engine.store.project(projectId);
      if (isManagementAction(action)) {
        request.result = await dependencies.conversationManagement.call(
          action,
          args,
          boundPrincipal,
          scopedDeviceAuthorized,
        );
      } else if (isDesktopControlConversationTool(action)) {
        const cwd = sessionWorkCwd(
          (await dependencies.featureMeta(boundPrincipal.sessionId)).session,
        );
        request.result = await dependencies.conversationDesktopControl.call(
          action,
          args,
          boundPrincipal,
          cwd,
          scopedDeviceAuthorized,
        );
      } else if (action === "sessions.list" || action === "sessions.read") {
        if (!(await dependencies.inHost(boundPrincipal.sessionId)))
          request.result = await dependencies.conversationDesktop.call(
            action,
            args,
            project.cwd,
            boundPrincipal,
            async () => !!(await dependencies.conversationAccess.principalForToken(request.token)),
          );
        else if (action === "sessions.list") {
          const { list } = await dependencies.projectSessionList(projectId);
          const page = conversationSessionPage(
            list.map((row) => ({ ...row, busy: row.status === "running" })),
            args,
          );
          if (!(await dependencies.conversationAccess.principalForToken(request.token)))
            throw new Error("Session authority revoked.");
          request.result = {
            cwd: project.cwd,
            total: page.total,
            nextCursor: page.nextCursor,
            state: page.state,
            sessions: await Promise.all(
              page.sessions.map(async (session) => {
                const locator = await dependencies.localSessionReference(session.id);
                return {
                  id: session.id,
                  title: session.title,
                  harness: session.harness,
                  model: session.model,
                  busy: session.status === "running",
                  hasDraft: !!session.draft,
                  updatedAt: session.updatedAt,
                  lastActivityAt:
                    session.runActivity?.lastActivityAt ?? session.lastActivityAt ?? null,
                  runActivity: session.runActivity ?? null,
                  ...(locator ? localSessionLinkFields(locator, session.title) : {}),
                };
              }),
            ),
          };
        } else {
          const target = await dependencies.featureSession(String(args.sessionId));
          if (target.projectId !== projectId)
            throw new Error("Conversation belongs to another project");
          request.result = sessionConversationPage(
            { ...target.session, busy: target.status === "running" },
            args,
            await dependencies.localSessionReference(target.session.id),
          );
        }
        if (!(await scopedDeviceAuthorized())) throw new Error("Session authority revoked.");
      } else if (action === "skills.search")
        request.result = await searchHarnessSkills(
          sessionWorkCwd((await dependencies.featureMeta(boundPrincipal.sessionId)).session),
          args,
          undefined,
          boundPrincipal.sessionId,
          await dependencies.explicitSkillNames(boundPrincipal.sessionId),
          (await dependencies.featureMeta(boundPrincipal.sessionId)).session.harness,
        );
      else if (action === "skills.read")
        request.result = await readHarnessSkill(
          sessionWorkCwd((await dependencies.featureMeta(boundPrincipal.sessionId)).session),
          {
            name: String(args.name),
            source: typeof args.source === "string" ? args.source : undefined,
            scope: typeof args.scope === "string" ? args.scope : undefined,
            offset: args.offset as number | undefined,
            maxChars: args.maxChars as number | undefined,
          },
          undefined,
          boundPrincipal.sessionId,
          await dependencies.explicitSkillNames(boundPrincipal.sessionId),
          (await dependencies.featureMeta(boundPrincipal.sessionId)).session.harness,
        );
      else if (action.startsWith("crews."))
        request.result = await dependencies.crews.call(action, args, projectId, boundPrincipal);
      else if (isRuntimeReadConversationTool(action))
        request.result = await dependencies.conversationRuntimeReads.call(
          action,
          args,
          boundPrincipal,
          async () => !!(await dependencies.conversationAccess.principalForToken(request.token)),
        );
      else if (isStewardConversationTool(action))
        request.result = await dependencies.conversationStewards.call(
          action,
          args,
          boundPrincipal,
          (await dependencies.featureSession(boundPrincipal.sessionId)).session,
          async () => !!(await dependencies.conversationAccess.principalForToken(request.token)),
        );
      else if (isTaskQueueTool(action))
        request.result = await dependencies.conversationTaskQueue.call(
          action,
          args,
          boundPrincipal,
          async () => !!(await dependencies.conversationAccess.principalForToken(request.token)),
        );
      else if (isGoalWriteTool(action))
        request.result = await dependencies.conversationGoals.call(
          action,
          args,
          boundPrincipal,
          async () => !!(await dependencies.conversationAccess.principalForToken(request.token)),
        );
      else if (isPullRequestWatchTool(action))
        request.result = await dependencies.pullRequestWatchTools.call(
          action,
          args,
          boundPrincipal,
          async () => !!(await dependencies.conversationAccess.principalForToken(request.token)),
        );
      else if (isSecretTool(action))
        request.result = await dependencies.conversationSecrets.call(
          action,
          args,
          boundPrincipal,
          async () => !!(await dependencies.conversationAccess.principalForToken(request.token)),
        );
      else if (isProjectConversationTool(action))
        request.result = await dependencies.conversationProject.call(
          action,
          args,
          boundPrincipal,
          async () => !!(await dependencies.conversationAccess.principalForToken(request.token)),
        );
      else if (isVisualConversationTool(action) || isImageConversationTool(action)) {
        const own = await dependencies.featureMeta(boundPrincipal.sessionId);
        if (own.projectId !== projectId)
          throw new Error("Conversation belongs to another project.");
        const root = await resolveHostWorktreeAsync(project.cwd, sessionWorkCwd(own.session));
        const dataDir = dirname(dependencies.engine.store.attachmentDir);
        request.result = isImageConversationTool(action)
          ? await callImageConversationTool(root, action, args, {
              session: own.session,
              projectId,
              engine: dependencies.engine,
              authorized: scopedDeviceAuthorized,
            })
          : await callVisualConversationTool(root, action, args, scopedDeviceAuthorized, {
              browser: dependencies.browserRuntime,
              dataDir,
            });
      } else if (isFileConversationTool(action)) {
        const own = await dependencies.featureMeta(boundPrincipal.sessionId);
        if (own.projectId !== projectId)
          throw new Error("Conversation belongs to another project.");
        const root = await resolveHostWorktreeAsync(project.cwd, sessionWorkCwd(own.session));
        request.result = await callFileConversationTool(
          root,
          action,
          args,
          async (command, input) => {
            if (!(await dependencies.conversationAccess.principalForToken(request.token)))
              throw new Error("Session authority revoked.");
            return await dependencies.workspace.run(command, input, request.tokenHash);
          },
        );
        if (!(await dependencies.conversationAccess.principalForToken(request.token)))
          throw new Error("Session authority revoked.");
      } else if (isWorkspaceConversationTool(action))
        request.result = await dependencies.conversationWorkspace.call(
          action,
          args,
          boundPrincipal,
          (await dependencies.featureSession(boundPrincipal.sessionId)).session,
          async () => !!(await dependencies.conversationAccess.principalForToken(request.token)),
        );
      else if (action === "tools.list") {
        const child = await dependencies.conversationDelegation.isChild(boundPrincipal.sessionId);
        request.result = {
          environmentId: dependencies.engine.store.environmentId,
          projectId,
          tools: sessionConversationToolCatalog()
            .filter(crewAllows)
            .filter((tool) => !child || agentToolAllowedForChild(tool.action)),
        };
      } else if (["tools.search", "tools.describe", "tools.status"].includes(action)) {
        const child = await dependencies.conversationDelegation.isChild(boundPrincipal.sessionId);
        request.result = managedDiscoveryResult(
          action,
          args,
          managedMcpCatalog()
            .filter(crewAllows)
            .filter((tool) => !child || agentToolAllowedForChild(tool.action)),
        );
      } else if (
        action.startsWith("ui.") ||
        action.startsWith("servers.") ||
        action === "machines.list" ||
        action === "terminals.list" ||
        action === "terminals.create" ||
        action === "terminals.close" ||
        action === "terminals.interrupt" ||
        action === "terminals.write" ||
        (action.startsWith("devices.") && args.machineId !== undefined)
      )
        request.result = await dependencies.conversationDesktop.call(
          action,
          args,
          project.cwd,
          boundPrincipal,
          async () => !!(await dependencies.conversationAccess.principalForToken(request.token)),
          action === "servers.ssh.execute"
            ? async () =>
                (await dependencies.featureMeta(boundPrincipal.sessionId)).session.runtimeMode ===
                "full-access"
            : undefined,
        );
      else if (RUNTIME_LOG_CONVERSATION_ACTIONS.has(action))
        request.result = await callRuntimeLogAction(
          dependencies,
          request,
          action,
          args,
          boundPrincipal,
        );
      else if (action === "logs.monitors.list")
        request.result = dependencies.logMonitors.list(projectId);
      else if (action === "logs.monitors.start")
        request.result = await dependencies.logMonitors.start(projectId, args.url);
      else if (action === "logs.monitors.stop") {
        await dependencies.logMonitors.stop(projectId, String(args.id));
        request.result = { stopped: true };
      } else if (action === "devices.preflight")
        request.result = await dependencies.deviceHost.preflight(
          args.deviceId as string | undefined,
          scopedDeviceEffect,
        );
      else if (action === "devices.preview")
        request.result = dependencies.devicePreviews.start(
          args as any,
          `${projectId}:${boundPrincipal.sessionId}`,
          scopedDeviceAuthorized,
        );
      else if (action === "devices.preview.status")
        request.result = await dependencies.devicePreviews.authorizedStatus(
          String(args.id),
          `${projectId}:${boundPrincipal.sessionId}`,
          args.includeFrame === true,
          scopedDeviceAuthorized,
        );
      else if (action === "devices.status")
        request.result = await dependencies.deviceHost.status(scopedDeviceEffect);
      else if (action === "devices.list")
        request.result = await dependencies.deviceHost.list(scopedDeviceEffect);
      else if (action === "devices.start")
        request.result = await dependencies.deviceHost.start(scopedDeviceEffect);
      else if (action === "devices.boot")
        request.result = await dependencies.deviceHost.boot(
          String(args.deviceId),
          scopedDeviceEffect,
        );
      else if (action === "devices.capture")
        request.result = await dependencies.deviceHost.capture(
          String(args.deviceId),
          scopedDeviceEffect,
        );
      else if (action === "devices.control.status")
        request.result = await dependencies.deviceHost.control.status(String(args.deviceId));
      else if (action === "devices.control.claim")
        request.result = await dependencies.deviceHost.control.claim(
          String(args.deviceId),
          `conversation:${request.tokenHash}:${boundPrincipal.sessionId}`,
          String(args.requestId),
          scopedDeviceAuthorized,
        );
      else if (action === "devices.control.release")
        request.result = await dependencies.deviceHost.control.release(
          String(args.deviceId),
          `conversation:${request.tokenHash}:${boundPrincipal.sessionId}`,
          String(args.leaseId),
        );
      else if (action === "devices.control.renew")
        request.result = await dependencies.deviceHost.control.renew(
          String(args.deviceId),
          `conversation:${request.tokenHash}:${boundPrincipal.sessionId}`,
          String(args.leaseId),
        );
      else if (action === "devices.inspect") {
        const id = String(args.deviceId),
          owner = `conversation:${request.tokenHash}:${boundPrincipal.sessionId}`,
          lease = String(args.leaseId);
        await dependencies.deviceHost.control.assert(id, owner, lease);
        request.result = await dependencies.deviceHost.inspect(id, `${owner}:${lease}`, {
          authorized: async () => {
            if (!(await scopedDeviceAuthorized())) return false;
            try {
              await dependencies.deviceHost.control.assert(id, owner, lease);
              return true;
            } catch {
              return false;
            }
          },
        });
      } else if (action === "devices.action")
        request.result = await dependencies.deviceHost.control.execute(
          String(args.deviceId),
          `conversation:${request.tokenHash}:${boundPrincipal.sessionId}`,
          String(args.leaseId),
          String(args.requestId),
          args.action,
          (track) =>
            dependencies.deviceHost.action(
              String(args.deviceId),
              args.action as DeviceAction,
              {
                track,
                authorized: async () => {
                  if (!(await scopedDeviceAuthorized())) return false;
                  try {
                    await dependencies.deviceHost.control.assert(
                      String(args.deviceId),
                      `conversation:${request.tokenHash}:${boundPrincipal.sessionId}`,
                      String(args.leaseId),
                    );
                    return true;
                  } catch {
                    return false;
                  }
                },
              },
              `conversation:${request.tokenHash}:${boundPrincipal.sessionId}:${String(args.leaseId)}`,
            ),
        );
      else if (action === "browser.preview")
        request.result = await dependencies.conversationPreviews.run(
          args as unknown as ConversationPreviewInput,
          { projectId, sessionId: boundPrincipal.sessionId, principalId: request.tokenHash },
          {
            authorize: async () => {
              if (!(await dependencies.conversationAccess.principalForToken(request.token)))
                throw new Error("Session authority revoked.");
            },
            browser: async (method, params) =>
              (await dependencies.sharedBrowser.recordings.dispatchForSession(
                method,
                { ...params, projectId, sessionId: boundPrincipal.sessionId },
                request.voiceBrowserOwner ?? request.token,
              )) as unknown as PreviewBrowserState,
            present: async () =>
              (await dependencies.conversationDesktop.call(
                "ui.tools.open",
                { tab: "browser", projectHost: true },
                project.cwd,
                boundPrincipal,
                async () =>
                  !!(await dependencies.conversationAccess.principalForToken(request.token)),
              )) as PreviewPresentation,
          },
        );
      else if (action.startsWith("browser.")) {
        request.result = await dependencies.sharedBrowser.recordings.dispatchForSession(
          action,
          { ...args, projectId, sessionId: boundPrincipal.sessionId },
          request.voiceBrowserOwner ?? request.token,
        );
        // Agents decide setup from real readiness, not from open:false.
        if (["browser.status", "browser.claim", "browser.release"].includes(action))
          request.result = await dependencies.browserRuntime.describe(request.result as object);
      } else if (action.startsWith("agents."))
        request.result = await dependencies.conversationDelegation.call(
          action,
          args,
          { sessionId: boundPrincipal.sessionId, projectId },
          (sessionId) => dependencies.localSessionReference(sessionId),
        );
      else if (action.startsWith("tasks.")) {
        const list = (await dependencies.tasks.list()).filter(
          (task) => task.projectId === projectId,
        );
        if (action === "tasks.create") {
          const own = (await dependencies.featureMeta(boundPrincipal.sessionId)).session;
          const input = {
            ...normalizeConversationTaskConfiguration(
              args,
              String(args.taskId),
              projectId,
              await dependencies.tasks.list(),
            ),
            id: String(args.taskId),
            projectId,
            title: String(args.title),
            prompt: String(args.prompt),
            harness: own.harness,
            providerAccountId: own.providerAccountId,
            model: own.model,
            modelSettings: own.modelSettings,
            runtimeMode: own.runtimeMode,
            maxRunMinutes: 0,
            ...CONVERSATION_TASK_EXECUTION_DEFAULTS,
            review: !args.crewDefinitionId,
            autoMerge: false,
            continueUntilDone: false,
            ...(args.crewDefinitionId ? { crewDefinitionId: String(args.crewDefinitionId) } : {}),
            status: args.status === "queued" ? "queued" : "todo",
          };
          const key = `task-create:${projectId}:${input.id}`;
          const fingerprint = createHash("sha256")
            .update(JSON.stringify([boundPrincipal.sessionId, input]))
            .digest("hex");
          request.result = await dependencies.engine.store.transaction(async () => {
            const receipt = (await dependencies.engine.store.db
              .prepare("SELECT value FROM metadata WHERE key=?")
              .get(key)) as { value: string } | undefined;
            const existing = await dependencies.tasks.get(input.id);
            if (receipt || existing) {
              if (receipt?.value !== fingerprint || !existing || existing.projectId !== projectId)
                throw new Error("Task ID was reused or its task no longer exists.");
              return existing;
            }
            const created = await dependencies.tasks.save(input);
            await dependencies.engine.store.db
              .prepare("INSERT INTO metadata(key,value) VALUES(?,?)")
              .run(key, fingerprint);
            return created;
          });
        } else if (action === "tasks.list") request.result = list;
        else {
          const task = list.find((task) => task.id === args.taskId);
          if (!task) throw new Error("Task is not in this project.");
          if (
            ![
              "tasks.get",
              "tasks.notes.read",
              "tasks.session.read",
              ...Object.keys(TASK_READ_TOOLS),
            ].includes(action) &&
            (task.sessionId === boundPrincipal.sessionId ||
              task.reviewer?.sessionId === boundPrincipal.sessionId)
          )
            throw new Error("An agent cannot change its own active task.");
          if (["tasks.delete", "tasks.transfer", "tasks.notes.resolve"].includes(action)) {
            if (task.updatedAt !== args.expectedUpdatedAt)
              throw new Error("Task changed; read it before changing it.");
            const destination =
              action === "tasks.transfer"
                ? await dependencies.engine.store.project(String(args.targetProjectId))
                : undefined;
            if (destination)
              await dependencies.tasks.validateTransfer(task.id, destination.id, task.updatedAt);
            if (
              action === "tasks.notes.resolve" &&
              !task.reviewNotes?.some((note) => note.id === args.noteId)
            )
              throw new Error("Review note not found.");
            const approvedTaskHash = createHash("sha256")
              .update(JSON.stringify(task))
              .digest("hex");
            const approved = (await dependencies.conversationDesktop.call(
              "tasks.write.authorize",
              {
                operation: {
                  action,
                  taskId: task.id,
                  title: scrubRuntimeLogText(task.title, 1000),
                  expectedUpdatedAt: task.updatedAt,
                  ...(destination
                    ? {
                        targetProjectId: destination.id,
                        targetProjectName: destination.name,
                      }
                    : {}),
                  ...(action === "tasks.notes.resolve"
                    ? {
                        noteId: args.noteId,
                        resolved: args.resolved,
                        note: scrubRuntimeLogText(
                          JSON.stringify(
                            task.reviewNotes?.find((note) => note.id === args.noteId) ?? null,
                          ),
                          4000,
                        ),
                      }
                    : {}),
                },
              },
              project.cwd,
              boundPrincipal,
              async () =>
                !!(await dependencies.conversationAccess.principalForToken(request.token)),
            )) as { approved?: boolean };
            if (
              !approved.approved ||
              !(await dependencies.conversationAccess.principalForToken(request.token))
            )
              throw new Error("Native owner approval required.");
            const latest = await dependencies.tasks.get(task.id);
            if (
              !latest ||
              latest.projectId !== projectId ||
              latest.updatedAt !== args.expectedUpdatedAt ||
              createHash("sha256").update(JSON.stringify(latest)).digest("hex") !== approvedTaskHash
            )
              throw new Error("Task changed during approval; read it again.");
            if (action === "tasks.delete") {
              await dependencies.tasks.delete(task.id, false, latest.updatedAt);
              request.result = { deleted: true };
            } else if (action === "tasks.transfer")
              request.result = await dependencies.tasks.transfer(
                task.id,
                String(args.targetProjectId),
                latest.updatedAt,
              );
            else
              request.result = await dependencies.tasks.resolveNote(
                task.id,
                args.noteId,
                args.resolved,
              );
          } else if (action === "tasks.get") request.result = task;
          else if (Object.hasOwn(TASK_READ_TOOLS, action))
            request.result = callConversationTaskRead(action, args, task, list);
          else if (action === "tasks.session.read") {
            const sessionId = args.role === "reviewer" ? task.reviewer?.sessionId : task.sessionId;
            if (!sessionId) throw new Error("This task has no session for the selected role.");
            const snapshot = await dependencies.featureSession(sessionId);
            if (snapshot.projectId !== projectId)
              throw new Error("Task session belongs to another project.");
            const limit = Number(args.limit ?? 20),
              after = Number(args.after ?? Math.max(0, snapshot.session.blocks.length - limit));
            const blocks = snapshot.session.blocks
              .slice(after, after + limit)
              .map((block) => scrubRuntimeLogText(JSON.stringify(block), 8192));
            request.result = {
              sessionId,
              status: snapshot.status,
              revision: snapshot.revision,
              totalBlocks: snapshot.session.blocks.length,
              blocks,
              next: after + blocks.length,
            };
          } else if (action === "tasks.start")
            request.result = await dependencies.tasks.startTask(task.id);
          else if (action === "tasks.retry") {
            if (task.status !== "blocked") throw new Error("Only blocked tasks can be retried.");
            request.result = await dependencies.tasks.move(task.id, "queued");
          } else if (action === "tasks.stop") {
            if (!["running", "verifying"].includes(task.status))
              throw new Error("Task is not running.");
            request.result = await dependencies.tasks.move(task.id, "blocked");
          } else if (action === "tasks.update") {
            if (
              args.title === undefined &&
              args.prompt === undefined &&
              args.dependsOn === undefined &&
              args.verifyCommand === undefined
            )
              throw new Error("Supply a title, prompt, dependencies or check command.");
            const { status: _status, ...input } = task;
            request.result = await dependencies.tasks.save({
              ...input,
              ...normalizeConversationTaskConfiguration(
                args,
                task.id,
                projectId,
                await dependencies.tasks.list(),
              ),
              ...(args.title !== undefined ? { title: args.title } : {}),
              ...(args.prompt !== undefined ? { prompt: args.prompt } : {}),
            });
          } else if (action === "tasks.review.recheck")
            request.result = await dependencies.tasks.recheckReview(task.id);
          else request.result = await dependencies.tasks.readNotes(task.id, args.noteIds);
        }
      } else if (action.startsWith("devServers.")) {
        const projects = [{ id: project.id, name: project.name, path: project.cwd }];
        if (action === "devServers.list") {
          const list = (await dependencies.devServers.handle(
            action,
            { projectId, refresh: args.refresh },
            projects,
          )) as {
            servers: { projectId?: string }[];
          };
          request.result = {
            ...list,
            servers: list.servers.filter((server) => server.projectId === projectId),
          };
        } else {
          let details: DevServerDetails | undefined;
          if (action !== "devServers.start") {
            details = (await dependencies.devServers.handle(
              "devServers.details",
              { ...args, projectId },
              projects,
            )) as DevServerDetails;
            if (details.server.projectId !== projectId)
              throw new Error(
                "Dev server belongs to another project or has no verified project association.",
              );
          }
          if (action === "devServers.openExternal") {
            const endpoint = details!.server.endpoints.find(
              (value) =>
                value.port === args.port &&
                (args.address === undefined || value.address === args.address),
            );
            if (!endpoint)
              throw new Error("The selected server is no longer listening on this port");
            request.result = await openDevServerBrowser(endpoint.url);
          } else {
            request.result = await dependencies.devServers.handle(
              action,
              { ...args, projectId, cwd: project.cwd },
              projects,
            );
            if (action === "devServers.logs") {
              const logs = request.result as { available: boolean; output: string };
              const clean = scrubRuntimeLogText(logs.output, Number.MAX_SAFE_INTEGER);
              const limit = Number(args.maxBytes ?? 32000);
              const bytes = Buffer.from(clean);
              request.result = {
                available: logs.available,
                output: bytes.subarray(Math.max(0, bytes.length - limit)).toString("utf8"),
                truncated: bytes.length > limit,
              };
            }
          }
        }
      } else if (action === "resources.read")
        request.result = {
          ...dependencies.diagnostics.read(`session:${boundPrincipal.sessionId}`),
          health:
            hostDegradedSince === undefined
              ? { state: "unknown" }
              : { state: "degraded", since: hostDegradedSince, reason: "unhandled-rejection" },
        };
      request.result = pageConversationListResult(action, originalArgs, request.result);
      await request.endResult(request.result, async () => {
        if (!(await scopedDeviceAuthorized())) throw new Error("Session authority revoked.");
        if (action === "devices.preview" || action === "devices.preview.status") {
          const original = dependencies.devicePreviews.resultAuthority(
            (request.result as { id: string }).id,
            `${projectId}:${boundPrincipal.sessionId}`,
          );
          if (!(await original())) throw new Error("Preview authority expired.");
        }
      });
      return;
    },
  );
}
