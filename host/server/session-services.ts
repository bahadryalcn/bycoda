import {
  type HostSession,
  type HostSessionSummary,
  type SessionSync,
  type SessionSyncResponse,
} from "../../src/features/connections/model/protocol";
import { parseRemoteAttachments, resolveAttachments } from "../attachments/attachments";
import { browseHostDirectories, createHostDirectory } from "../browser/browse";
import { DesktopCommandDelivery } from "../desktop/desktop-command-delivery";
import { createProjectsService } from "../domains/projects/service";
import {
  createSessionQueueService,
  type SessionQueueAction,
} from "../domains/sessions/queue-service";
import { createSessionReadService } from "../domains/sessions/service";
import {
  partialSessionSync,
  previewRewindHistory,
  previewSession,
  transcriptPage,
  withHead,
} from "../sessions/transcriptPage";
import type { ServerBindings } from "./bindings";
import { DESKTOP_RUN_ID } from "./support";
export function createSessionServicesRuntime(
  dependencies: Pick<
    ServerBindings,
    | "namedProjects"
    | "desktop"
    | "engine"
    | "projectSessionList"
    | "readSessionView"
    | "catchUp"
    | "desktopWatch"
    | "desktopView"
    | "desktopSync"
    | "desktopRecheckMs"
    | "transcriptPages"
    | "transfers"
    | "revisionWaits"
    | "sessionSourceEpoch"
    | "queueSessionKnown"
    | "sessionQueues"
    | "attachmentOwnership"
  >,
) {
  const projectsService = createProjectsService({
    list: dependencies.namedProjects,
    directoryPorts: {
      directory: async () =>
        dependencies.desktop.live.projectDirectory(
          await dependencies.engine.store.projects(),
          dependencies.engine.store.environmentId,
        ),
      browse: browseHostDirectories,
      createDirectory: createHostDirectory,
      open: (cwd, authorized) =>
        dependencies.engine.store.db.withAuthorization(authorized, () =>
          dependencies.engine.openProject(cwd),
        ),
    },
  });
  const sessionService = createSessionReadService<
    HostSession,
    Extract<SessionSync, { kind: "delta" }>["value"],
    HostSessionSummary,
    SessionSyncResponse
  >({
    repository: {
      projectList: dependencies.projectSessionList,
      session: (id, signal) => dependencies.engine.store.session(id, signal),
      sync: (id, revision, signal) => dependencies.engine.store.sync(id, revision, signal),
      readView: dependencies.readSessionView,
      catchUp: (id, signal) => dependencies.catchUp(id, undefined, signal),
    },
    nativeProjection: {
      watch: dependencies.desktopWatch,
      view: dependencies.desktopView,
      sync: dependencies.desktopSync,
      recheckMs: dependencies.desktopRecheckMs,
    },
    transcript: {
      page: (...args) => dependencies.transcriptPages.page(...args),
      preview: previewSession,
      summaryPage: (value) => transcriptPage(value, undefined, undefined, true),
      partial: partialSessionSync,
      withHead,
      previewRewindHistory,
    },
    transfers: dependencies.transfers,
    revisionWaits: dependencies.revisionWaits,
    sourceEpoch: dependencies.sessionSourceEpoch,
  });
  const sessionQueueService = createSessionQueueService({
    environmentId: dependencies.engine.store.environmentId,
    transaction: (work) => dependencies.engine.store.transaction(work, "critical"),
    sessionStatus: dependencies.queueSessionKnown,
    desktopWatch: dependencies.desktopWatch,
    queues: {
      get: (id) => dependencies.sessionQueues.get(id),
      serve: (...args) => dependencies.sessionQueues.serve(...args),
    },
    attachments: {
      validateExposure: (params) => dependencies.attachmentOwnership.validateExposure(params),
      normalize: (raw) =>
        resolveAttachments(dependencies.engine.store, parseRemoteAttachments(raw)),
    },
  });
  const queueOperation =
    (action: SessionQueueAction) =>
    async (
      params: Record<string, unknown>,
      context: import("../domains/context").HostDomainContext,
    ) => {
      const exposeAttachments = context.exposeQueueAttachments;
      if (!exposeAttachments)
        throw new Error("Authenticated queue attachment grant is unavailable.");
      return sessionQueueService[action](params, { ...context, exposeAttachments });
    };
  const desktopCommandDelivery = new DesktopCommandDelivery(
    dependencies.desktop.live,
    dependencies.engine.store,
  );
  const questionBinding = async (sessionId: string, runId: string, requestId: number) => {
    const view = await dependencies.readSessionView(sessionId);
    // A live desktop may own a Host-backed conversation whose native transcript
    // is unavailable here. Its authenticated original heartbeat owns the prompt.
    const desktopQuestion =
      runId === DESKTOP_RUN_ID && dependencies.desktop.live.busyClient(sessionId)
        ? dependencies.desktop.live.overlay(sessionId)?.patch.pendingQuestion
        : undefined;
    const question = desktopQuestion ?? view.session.pendingQuestion;
    const currentRun = desktopQuestion ? DESKTOP_RUN_ID : view.runId;
    if (currentRun !== runId || question?.requestId !== requestId || !question.occurrenceId)
      throw new Error("The original question is no longer available");
    return question.occurrenceId;
  };
  const bindQuestionUpload = async (principal: string, params: Record<string, unknown>) => {
    if (
      params.questionSessionId === undefined &&
      params.questionRequestId === undefined &&
      params.questionRunId === undefined
    ) {
      await dependencies.attachmentOwnership.assertUnboundUpload(String(params.id ?? ""));
      return;
    }
    const sessionId = String(params.questionSessionId ?? "");
    const runId = String(params.questionRunId ?? "");
    const requestId = params.questionRequestId;
    if (!sessionId || !runId || !Number.isSafeInteger(requestId) || Number(requestId) < 0)
      throw new Error("Invalid question attachment binding");
    const occurrence = await questionBinding(sessionId, runId, Number(requestId));
    await dependencies.attachmentOwnership.bindQuestion(
      principal,
      String(params.id ?? ""),
      sessionId,
      runId,
      Number(requestId),
      occurrence,
    );
  };
  return {
    projectsService,
    sessionService,
    sessionQueueService,
    queueOperation,
    desktopCommandDelivery,
    questionBinding,
    bindQuestionUpload,
  };
}
