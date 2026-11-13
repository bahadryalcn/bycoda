import { AssistantRepository } from "../assistant/repository";
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
  const roomAttestationSigner = new RoomAttestationSigner(
    roomAttestationKeyPath(dirname(dependencies.engine.store.attachmentDir)),
    dependencies.engine.store.environmentId,
    (id) => assistant.threadBinding(id),
  );
  await assistant.ready;
  dependencies.tasks.assistantGoalAdmission = (goalId) => assistant.autonomousJobAllowed(goalId);
  const previousProviderSchedule = dependencies.engine.beforeProviderTurn;
  dependencies.engine.beforeProviderTurn = async (input) => {
    await previousProviderSchedule?.(input);
    if (input.author?.kind !== "task") return;
    const authorId = input.author.id;
    const task = await dependencies.tasks.get(authorId);
    const goalId =
      task?.goalId ?? (await dependencies.goals.list()).find((goal) => goal.id === authorId)?.id;
    if (goalId && !(await assistant.autonomousJobAllowed(goalId)))
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
