import { AssistantRepository } from "../assistant/repository";
import { stopAssistantOwnedWork } from "../assistant/work/assistant-owned-work";
import { journalAssistantSessionPorts } from "../assistant/management/assistant-session-action-journal";
import { registerAssistantHelperExecutor } from "../work/helper-adapter";
import { registerAssistantSessionExecutor } from "../work/assistant-session-work";
import { registerRoomAutomations } from "../automations/room-execution";
import { roomAutomationTools } from "../automations/room-tools";
import { RoomAutomationChildren } from "../automations/room-children";
import { listAssistantTelegramTargets } from "../social/notifications/assistant-telegram-targets";
import { dirname } from "node:path";
import { HostAssistantKeepAwake } from "../assistant/core/assistant-keep-awake";
import {
  assistantExecutionPorts,
  type SessionWriteOrder,
} from "../assistant/core/assistant-runtime";
import { AssistantTurnPolicyDeferredError } from "../assistant/core/assistant-turn-policy";
import {
  RoomAttestationSigner,
  roomAttestationKeyPath,
} from "../assistant/room/assistant-room-attestation";
import { createAssistantModelSelector } from "../assistant/models/assistant-model-execution";
import { hostModelRoutingService } from "../model-routing/runtime";
import { HostAssistant } from "../assistant/service";
import { HostAssistantManualSessions } from "../assistant/sessions/assistant-manual-sessions";
import { assistantSessionRuntime } from "../assistant/sessions/assistant-session-runtime";
import { HostDesktopHelper } from "../desktop-helper";
import { HostDesktopControl } from "../desktop/desktop-control-host";
import { readDesktopPresenceWithVoice } from "../desktop/desktop-voice-activity";
import { projectDisplayNames } from "../projects/project-display-names";
import type { ServerBindings } from "./bindings";
export async function createAssistantRuntime(
  dependencies: Pick<
    ServerBindings,
    | "engine"
    | "goals"
    | "tasks"
    | "hostNotes"
    | "automations"
    | "desktop"
    | "models"
    | "pushDevices"
    | "conversationDesktop"
    | "visibilityAdmission"
    | "social"
    | "terminals"
  >,
  publish: (runtime: Awaited<ReturnType<typeof createAssistantRuntime>>) => void,
) {
  publish({
    get assistantPorts() {
      return assistantPorts;
    },
    get namedProjects() {
      return namedProjects;
    },
    get assistantKeepAwake() {
      return assistantKeepAwake;
    },
    get assistant() {
      return assistant;
    },
    get roomAttestationSigner() {
      return roomAttestationSigner;
    },
    get previousProviderSchedule() {
      return previousProviderSchedule;
    },
    get manualAssistantSessions() {
      return manualAssistantSessions;
    },
    get managedAssistantSessions() {
      return managedAssistantSessions;
    },
    get desktopControl() {
      return desktopControl;
    },
    get desktopHelper() {
      return desktopHelper;
    },
    get previousOwnerInstructions() {
      return previousOwnerInstructions;
    },
  });

  const orderSessionWrite: SessionWriteOrder = (id, write) =>
    dependencies.engine.sessionStoreWrite(id, write);
  const assistantPorts = assistantExecutionPorts(
    dependencies.engine.store,
    dependencies.goals,
    dependencies.tasks,
    () => dependencies.hostNotes,
    () => dependencies.automations,
    createAssistantModelSelector({
      routing: () => hostModelRoutingService(dependencies.engine.store),
      repository: new AssistantRepository(dependencies.engine.store),
    }),
    orderSessionWrite,
  );
  const namedProjects = async () => {
    const registered = await dependencies.engine.store.projects();
    return projectDisplayNames(
      registered,
      dependencies.desktop.live.projectDirectory(
        registered,
        dependencies.engine.store.environmentId,
      ),
    );
  };
  assistantPorts.listProjects = async () =>
    (await namedProjects()).map((project) => ({
      id: project.id,
      path: project.cwd,
      name: project.name,
    }));
  const assistantKeepAwake = new HostAssistantKeepAwake();
  assistantPorts.keepAwake = (enabled) => assistantKeepAwake.setEnabled(enabled);
  assistantPorts.readPushPhones = () => dependencies.pushDevices.recipients();
  assistantPorts.readPresence = readDesktopPresenceWithVoice;
  const assistant = new HostAssistant(dependencies.engine.store, assistantPorts);
  const roomChildren = new RoomAutomationChildren(dependencies.engine.store, () => ({
    engine: dependencies.engine,
    tasks: dependencies.tasks,
    goals: dependencies.goals,
    automations: dependencies.automations,
    get terminals() {
      return dependencies.terminals;
    },
    get conversationDesktop() {
      return dependencies.conversationDesktop;
    },
    assistant,
    assistantPorts,
  }));
  assistantPorts.notificationTargets = async () =>
    listAssistantTelegramTargets(dependencies.social, (await assistant.globalRoomBinding())?.id);
  registerAssistantHelperExecutor(dependencies.engine.store);
  registerAssistantSessionExecutor(dependencies.engine.store, dependencies.engine);
  registerRoomAutomations(
    dependencies.engine.store,
    dirname(dependencies.engine.store.attachmentDir),
    () => assistant.globalRoomBinding(),
    roomAutomationTools(
      assistantPorts,
      () => dependencies,
      dependencies.engine.store.environmentId,
      roomChildren,
    ),
  );
  const roomAttestationSigner = new RoomAttestationSigner(
    roomAttestationKeyPath(dirname(dependencies.engine.store.attachmentDir)),
    dependencies.engine.store.environmentId,
    (id) => assistant.threadBinding(id),
  );
  await assistant.ready;
  dependencies.tasks.assistantGoalAdmission = async (goalId) =>
    (await roomChildren.goalAllowed(goalId)) && (await assistant.autonomousJobAllowed(goalId));
  dependencies.tasks.assistantTaskAdmission = async (task) =>
    (await roomChildren.taskAllowed(task)) && (await assistant.ownedTaskAllowed(task));
  dependencies.automations.roomParentAdmission = (automation, run) =>
    roomChildren.automationAllowed(automation, run);
  await roomChildren
    .recover()
    .catch((error) => console.error("Room child recovery remains held:", error));
  assistantPorts.stopOwnedWork = async () => {
    const errors: unknown[] = [];
    try {
      await roomChildren.stopAll();
    } catch (error) {
      errors.push(error);
    }
    try {
      await stopAssistantOwnedWork(
        dependencies.engine.store,
        dependencies.tasks,
        dependencies.goals,
        dependencies.automations,
      );
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new Error("Assistant Stop retains unproven original work; inspect its receipts.");
  };
  const previousProviderSchedule = dependencies.engine.beforeProviderTurn;
  dependencies.engine.beforeProviderTurn = async (input) => {
    await previousProviderSchedule?.(input);
    if (
      input.author?.kind === "assistant-room" &&
      !(await roomChildren.sessionAllowed(input.sessionId, input.runId, input.author.operationId))
    )
      throw new AssistantTurnPolicyDeferredError();
    const crew = await dependencies.engine.store.db
      .prepare(
        "SELECT payload FROM crew_runs_v2 WHERE coordinator_session_id=? AND status<>'finished'",
      )
      .get(input.sessionId);
    if (crew) {
      const run = JSON.parse(String(crew.payload)) as {
        id: string;
        projectId: string;
        sourceTaskId?: string;
      };
      if (run.sourceTaskId) {
        const root = await dependencies.tasks.get(run.sourceTaskId);
        if (
          !root ||
          root.projectId !== run.projectId ||
          root.crewExecutionId !== run.id ||
          !(await roomChildren.taskAllowed(root))
        )
          throw new AssistantTurnPolicyDeferredError();
      }
    }
    if (!(await assistant.ownedSessionAllowed(input.sessionId)))
      throw new AssistantTurnPolicyDeferredError();
    if (input.author?.kind !== "task") return;
    const authorId = input.author.id;
    const task = await dependencies.tasks.get(authorId);
    if (
      task &&
      (!(await roomChildren.taskAllowed(task)) || !(await assistant.ownedTaskAllowed(task)))
    )
      throw new AssistantTurnPolicyDeferredError();
    const goalId =
      task?.goalId ?? (await dependencies.goals.list()).find((goal) => goal.id === authorId)?.id;
    if (
      goalId &&
      (!(await roomChildren.goalAllowed(goalId)) || !(await assistant.autonomousJobAllowed(goalId)))
    )
      throw new AssistantTurnPolicyDeferredError();
  };
  assistantPorts.manualProjectVisible = async (id) => {
    const directory = dependencies.desktop.live.projectDirectory(
      await dependencies.engine.store.projects(),
      dependencies.engine.store.environmentId,
    );
    return directory.privacyReady && directory.projects.some((project) => project.id === id);
  };
  const manualAssistantSessions = new HostAssistantManualSessions(dependencies.engine.store, {
    enabled: () => assistant.manualSupervisionAllowed(),
    name: () => assistant.identityName(),
    visibleProject: (id) => assistant.manualProjectAllowed(id),
    orderSessionWrite,
  });
  await manualAssistantSessions.ready;
  assistantPorts.manual = manualAssistantSessions;
  const managedAssistantSessions = assistantSessionRuntime(
    dependencies.engine.store,
    dependencies.engine,
    assistant,
    dependencies.tasks,
    manualAssistantSessions,
  );
  await managedAssistantSessions.ready;
  assistantPorts.detachSession = async (input) => {
    const result = await managedAssistantSessions.detach(
      input.jobId,
      input.sessionId,
      input.expectedVersion,
    );
    await orderSessionWrite(input.sessionId, () =>
      dependencies.engine.store.markAssistantManagedSession(input.sessionId, input.jobId),
    );
    return result;
  };
  assistantPorts.manageSession = async (input) => {
    const result = await managedAssistantSessions.request(
      { op: "nudge", ...input },
      {
        kind: "chief",
        id: `assistant-chief:${dependencies.engine.store.environmentId}`,
      },
    );
    if (result.recovery) return result.recovery;
    if (result.operation?.delivery !== "delivered")
      throw new Error(
        "Managed session delivery remains unknown; inspect its state before continuing.",
      );
  };
  assistantPorts.manageManualSession = async (input) => {
    const result = await managedAssistantSessions.request(
      { op: "nudge", ...input },
      {
        kind: "chief",
        id: `assistant-chief:${dependencies.engine.store.environmentId}`,
      },
    );
    if (result.operation?.delivery !== "delivered")
      throw new Error(
        "Manual conversation delivery remains unknown; inspect its state before continuing.",
      );
  };
  assistantPorts.answerSession = async (input) => {
    const result = await managedAssistantSessions.request(
      { op: "answer", ...input },
      {
        kind: "chief",
        id: `assistant-chief:${dependencies.engine.store.environmentId}`,
      },
    );
    if (result.operation?.delivery !== "submitted")
      throw new Error(
        "Worker question submission remains unknown; inspect the original question before continuing.",
      );
  };
  assistantPorts.onPause = () => managedAssistantSessions.stop();
  journalAssistantSessionPorts(dependencies.engine.store, assistant.actionJournal, assistantPorts);
  assistantPorts.onResume = () => managedAssistantSessions.resume();
  assistantPorts.onJobPause = (id) => managedAssistantSessions.pauseJob(id);
  assistantPorts.onJobResume = (id) => managedAssistantSessions.resumeJob(id);
  const desktopControl = new HostDesktopControl(dependencies.engine.store, {
    onOperation: (event) => assistant.recordDesktopOperation(event),
    presence: readDesktopPresenceWithVoice,
    // Headed actions on this route are explicitly requested by the device owner.
    // Agents use their separate captured principal and never inherit this grant.
    physicalGrant: async (principal) => principal.kind === "owner",
  });
  await desktopControl.ready;
  const desktopHelper = new HostDesktopHelper({
    outsideScope: (work) => dependencies.engine.store.db.outsideScope(work),
  });
  const previousOwnerInstructions = dependencies.engine.ownerInstructions;
  dependencies.engine.ownerInstructions = async () =>
    [await previousOwnerInstructions?.(), await assistant.instructions("sessions")]
      .filter(Boolean)
      .join("\n");
  return {
    assistantPorts,
    namedProjects,
    assistantKeepAwake,
    assistant,
    roomAttestationSigner,
    previousProviderSchedule,
    manualAssistantSessions,
    managedAssistantSessions,
    desktopControl,
    desktopHelper,
    previousOwnerInstructions,
  };
}
