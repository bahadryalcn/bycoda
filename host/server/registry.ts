import { NATIVE_BUFFER_UPLOAD_METHODS } from "../../src/shared/model/host-contracts/native-buffer-upload";
import { NATIVE_DELIVERY_METHODS } from "../../src/shared/model/host-contracts/native-delivery";
import {
  DEVICE_LIFECYCLE_METHODS,
  MOBILE_DEVICE_PREVIEW_METHODS,
  NATIVE_DEVICE_METHODS,
} from "../../src/shared/model/host-contracts/native-devices";
import { NATIVE_SERVICE_UPLOAD_METHODS } from "../../src/shared/model/host-contracts/native-service-upload";
import { NATIVE_SERVICE_METHODS } from "../../src/shared/model/host-contracts/native-services";
import { NATIVE_WORKSPACE_METHODS } from "../../src/shared/model/host-contracts/native-workspaces";
import { desktopHelperDomain } from "../desktop-helper-domain";
import { desktopControlDomain } from "../desktop/desktop-control-domain";
import { assistantDomain } from "../domains/assistant/service";
import { type HostDomainContext } from "../domains/context";
import { createHostDispatcher } from "../transport/dispatch";
import type { ServerBindings } from "./bindings";
import { createHostModelRoutingService } from "../model-routing/runtime";
import { createModelRoutingDomainService } from "../domains/model-routing/service";
import { readUsageLimits } from "../usage/limits-report";
import { hostUsageLimitsDeps } from "./usage-limits-deps";
import { resolveBinary } from "./support";
export function createRegistryRuntime(
  dependencies: Pick<
    ServerBindings,
    | "engine"
    | "models"
    | "environmentService"
    | "projectsService"
    | "assistant"
    | "desktopControl"
    | "desktopHelper"
    | "nativeDeliveryService"
    | "nativeDevicesService"
    | "nativeServiceUploads"
    | "nativeServicesService"
    | "modelsService"
    | "nativeBufferUploads"
    | "nativeWorkspacesService"
    | "crewOperation"
    | "sessionService"
    | "commandService"
    | "queueOperation"
    | "fileService"
    | "sprintsService"
    | "automationsService"
    | "devServersService"
    | "goalsService"
    | "stewardsService"
    | "tasksService"
    | "notesService"
    | "gitService"
    | "terminalService"
    | "persistenceService"
  >,
) {
  const modelRouting = createHostModelRoutingService({
    store: dependencies.engine.store,
    catalog: () => dependencies.models(),
    readLimits: () => readUsageLimits(hostUsageLimitsDeps(dependencies.engine.store.environmentId)),
    command: async (provider) => (await resolveBinary[provider]()).path,
  });
  const modelRoutingService = createModelRoutingDomainService(modelRouting);
  const domainDispatcher = createHostDispatcher({
    environmentId: dependencies.engine.store.environmentId,
    environment: dependencies.environmentService,
    projects: dependencies.projectsService,
    operations: {
      "assistant.request": assistantDomain(dependencies.assistant, dependencies.engine.store),
      "desktop.request": desktopControlDomain(
        dependencies.desktopControl,
        dependencies.engine.store,
      ),
      "desktop.helper.request": desktopHelperDomain(
        dependencies.desktopHelper,
        dependencies.engine.store,
      ),
      ...Object.fromEntries(
        NATIVE_DELIVERY_METHODS.map((method) => [
          method,
          (params: Record<string, unknown>, context: HostDomainContext) =>
            dependencies.nativeDeliveryService.call(method, params, context),
        ]),
      ),
      ...Object.fromEntries(
        [
          ...NATIVE_DEVICE_METHODS,
          ...DEVICE_LIFECYCLE_METHODS,
          ...MOBILE_DEVICE_PREVIEW_METHODS,
        ].map((method) => [
          method,
          (params: Record<string, unknown>, context: HostDomainContext) =>
            dependencies.nativeDevicesService.call(method, params, context),
        ]),
      ),
      ...Object.fromEntries(
        NATIVE_SERVICE_UPLOAD_METHODS.map((method) => [
          method,
          (params: Record<string, unknown>, context: HostDomainContext) =>
            dependencies.nativeServiceUploads.call(method, params, context),
        ]),
      ),
      ...Object.fromEntries(
        NATIVE_SERVICE_METHODS.map((method) => [
          method,
          (params: Record<string, unknown>, context: HostDomainContext) =>
            dependencies.nativeServicesService.call(method, params, context),
        ]),
      ),
      "models.list": dependencies.modelsService.list,
      "modelRouting.get": modelRoutingService.get,
      "modelRouting.save": modelRoutingService.save,
      "modelRouting.status": modelRoutingService.status,
      "modelRouting.resolve": modelRoutingService.resolve,
      ...Object.fromEntries(
        NATIVE_BUFFER_UPLOAD_METHODS.map((method) => [
          method,
          (params: Record<string, unknown>, context: HostDomainContext) =>
            dependencies.nativeBufferUploads.call(method, params, context),
        ]),
      ),
      ...Object.fromEntries(
        NATIVE_WORKSPACE_METHODS.map((method) => [
          method,
          (params: Record<string, unknown>, context: HostDomainContext) =>
            dependencies.nativeWorkspacesService.call(method, params, context),
        ]),
      ),
      "crews.active.list": dependencies.crewOperation("crews.active.list"),
      "crews.member.ask": dependencies.crewOperation("crews.member.ask"),
      "crews.list": dependencies.crewOperation("crews.list"),
      "crews.schema": dependencies.crewOperation("crews.schema"),
      "crews.inspect": dependencies.crewOperation("crews.inspect"),
      "crews.save": dependencies.crewOperation("crews.save"),
      "crews.delete": dependencies.crewOperation("crews.delete"),
      "crews.deleteRun": dependencies.crewOperation("crews.deleteRun"),
      "crews.agent.save": dependencies.crewOperation("crews.agent.save"),
      "crews.agent.delete": dependencies.crewOperation("crews.agent.delete"),
      "crews.start": dependencies.crewOperation("crews.start"),
      "crews.get": dependencies.crewOperation("crews.get"),
      "crews.assign": dependencies.crewOperation("crews.assign"),
      "crews.request": dependencies.crewOperation("crews.request"),
      "crews.resolve": dependencies.crewOperation("crews.resolve"),
      "crews.respond": dependencies.crewOperation("crews.respond"),
      "crews.answer": dependencies.crewOperation("crews.answer"),
      "crews.pause": dependencies.crewOperation("crews.pause"),
      "crews.stop": dependencies.crewOperation("crews.stop"),
      "crews.resume": dependencies.crewOperation("crews.resume"),
      "crews.accept": dependencies.crewOperation("crews.accept"),
      "crews.finish": dependencies.crewOperation("crews.finish"),
      "sessions.list": dependencies.sessionService.list,
      "sessions.page": dependencies.sessionService.page,
      "sessions.sync": dependencies.sessionService.sync,
      "sessions.get": dependencies.sessionService.get,
      "sessions.block": dependencies.sessionService.block,
      "sessions.workedTime": dependencies.sessionService.workedTime,
      "sessions.syncChunk": dependencies.sessionService.syncChunk,
      "commands.status": dependencies.commandService.status,
      "commands.dispatch": dependencies.commandService.dispatch,
      "sessions.queue.get": dependencies.queueOperation("get"),
      "sessions.queue.change": dependencies.queueOperation("change"),
      "sessions.queue.claim": dependencies.queueOperation("claim"),
      "sessions.queue.finish": dependencies.queueOperation("finish"),
      "sessions.queue.release": dependencies.queueOperation("release"),
      "sessions.queue.lease": dependencies.queueOperation("lease"),
      "files.read": dependencies.fileService.read,
      "files.list": dependencies.fileService.list,
      "files.index": dependencies.fileService.index,
      "files.search": dependencies.fileService.search,
      "files.searchContent": dependencies.fileService.searchContent,
      "files.create": dependencies.fileService.create,
      "files.write": dependencies.fileService.write,
      "sprints.list": dependencies.sprintsService.list,
      "sprints.get": dependencies.sprintsService.get,
      "sprints.create": dependencies.sprintsService.create,
      "sprints.update": dependencies.sprintsService.update,
      "sprints.start": dependencies.sprintsService.start,
      "sprints.complete": dependencies.sprintsService.complete,
      "sprints.archive": dependencies.sprintsService.archive,
      "sprints.plan": dependencies.sprintsService.plan,
      "sprints.report": dependencies.sprintsService.report,
      "sprints.ingest": dependencies.sprintsService.ingest,
      "sprints.goalContext": dependencies.sprintsService.setGoalContext,
      "automations.list": dependencies.automationsService.list,
      "automations.preview": dependencies.automationsService.preview,
      "automations.save": dependencies.automationsService.save,
      "automations.delete": dependencies.automationsService.delete,
      "automations.runs": dependencies.automationsService.runs,
      "automations.runNow": dependencies.automationsService.runNow,
      "devServers.list": dependencies.devServersService.list,
      "devServers.details": dependencies.devServersService.details,
      "devServers.start": dependencies.devServersService.start,
      "devServers.stop": dependencies.devServersService.stop,
      "devServers.kill": dependencies.devServersService.kill,
      "devServers.restart": dependencies.devServersService.restart,
      "devServers.logs": dependencies.devServersService.logs,
      "devServers.openExternal": dependencies.devServersService.openExternal,
      "devServers.bridgeCheck": dependencies.devServersService.bridgeCheck,
      "devServers.bridgeOpen": dependencies.devServersService.bridgeOpen,
      "devServers.bridgeRead": dependencies.devServersService.bridgeRead,
      "devServers.bridgeWrite": dependencies.devServersService.bridgeWrite,
      "devServers.bridgeClose": dependencies.devServersService.bridgeClose,
      "goals.list": dependencies.goalsService.list,
      "goals.create": dependencies.goalsService.create,
      "goals.finalReview.recheck": dependencies.goalsService.recheckFinalReview,
      "goals.approve": dependencies.goalsService.approve,
      "goals.update": dependencies.goalsService.update,
      "goals.replan": dependencies.goalsService.replan,
      "goals.cancel": dependencies.goalsService.cancel,
      "goals.delete": dependencies.goalsService.delete,
      "stewards.list": dependencies.stewardsService.list,
      "stewards.save": dependencies.stewardsService.save,
      "stewards.delete": dependencies.stewardsService.delete,
      "stewards.runNow": dependencies.stewardsService.runNow,
      "stewards.decline": dependencies.stewardsService.decline,
      "tasks.snapshotWithCursor": dependencies.tasksService.snapshotWithCursor,
      "tasks.events": dependencies.tasksService.events,
      "tasks.list": dependencies.tasksService.list,
      "tasks.save": dependencies.tasksService.save,
      "tasks.move": dependencies.tasksService.move,
      "tasks.start": dependencies.tasksService.start,
      "tasks.reorder": dependencies.tasksService.reorder,
      "tasks.retarget": dependencies.tasksService.retarget,
      "tasks.review.recheck": dependencies.tasksService.recheckReview,
      "tasks.notes.read": dependencies.tasksService.readNotes,
      "tasks.notes.resolve": dependencies.tasksService.resolveNote,
      "tasks.delete": dependencies.tasksService.delete,
      "tasks.preflight": dependencies.tasksService.preflight,
      "tasks.evaluation.save": dependencies.tasksService.recordEvaluation,
      "projects.directory": dependencies.projectsService.directory,
      "projects.browse": dependencies.projectsService.browse,
      "projects.createDirectory": dependencies.projectsService.createDirectory,
      "projects.open": dependencies.projectsService.open,
      "notes.list": dependencies.notesService.list,
      "notes.get": dependencies.notesService.get,
      "notes.upsert": dependencies.notesService.upsert,
      "notes.delete": dependencies.notesService.delete,
      "git.diff": dependencies.gitService.diff,
      "git.branches": dependencies.gitService.branches,
      "git.switch": dependencies.gitService.switch,
      "git.createBranch": dependencies.gitService.createBranch,
      "git.worktrees": dependencies.gitService.worktrees,
      "git.worktreeCreate": dependencies.gitService.worktreeCreate,
      "git.index": dependencies.gitService.index,
      "git.fileDiff": dependencies.gitService.fileDiff,
      "git.action": dependencies.gitService.action,
      "terminals.list": dependencies.terminalService.list,
      "terminals.create": dependencies.terminalService.create,
      "terminals.read": dependencies.terminalService.read,
      "terminals.write": dependencies.terminalService.write,
      "terminals.interrupt": dependencies.terminalService.interrupt,
      "terminals.close": dependencies.terminalService.close,
      "environment.persistence.status": dependencies.persistenceService.status,
      "environment.persistence.recover": dependencies.persistenceService.recover,
    },
  });
  return { domainDispatcher };
}
