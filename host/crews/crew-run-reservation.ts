import type { HostStore } from "../store";
import type { HostTasks } from "../tasks/tasks";
import {
  crewWorkTitle,
  type CrewCandidate,
  type CrewDefinition,
  type CrewRun,
} from "../../src/features/crews/model/crew";
import type { RuntimeMode } from "../../src/features/sessions/model/session";
import type { CrewState, Principal } from "./crew-ports";

type TaskOrigin = {
  kind: "task";
  id: string;
  projectId: string;
  threadId: string;
  state: "pending" | "completed";
  entityCreatedAt?: number;
};

/** Reserve the run and its canonical task together after model discovery. */
export async function reserveCrewRun({
  store,
  tasks,
  read,
  write,
  reviewedThread,
  onAssistantTaskOrigin,
  checkOperationAuthority,
  now,
  projectId,
  definitionId,
  prompt,
  requestId,
  principal,
  newConversation,
  sourceTaskId,
  signature,
  definition,
  mode,
  selected,
  routingWait,
}: {
  store: HostStore;
  tasks: HostTasks;
  read: () => Promise<CrewState>;
  write: (state: CrewState) => Promise<void>;
  reviewedThread: () => { threadId: string } | undefined;
  onAssistantTaskOrigin?: (origin: TaskOrigin) => Promise<void>;
  checkOperationAuthority: () => Promise<void>;
  now: () => number;
  projectId: string;
  definitionId: string;
  prompt: string;
  requestId: string;
  principal?: Principal;
  newConversation: boolean;
  sourceTaskId?: string;
  signature: string;
  definition: CrewDefinition;
  mode?: RuntimeMode;
  selected: { candidate: CrewCandidate; reason: string };
  routingWait?: CrewRun["routingWait"];
}) {
  return store.db.scope(async () => {
    const current = await read();
    const duplicate = current.runs.find((r) => r.id === requestId);
    if (duplicate) {
      if (
        duplicate.projectId !== projectId ||
        (principal &&
          (newConversation ? duplicate.requestedBySessionId : duplicate.coordinatorSessionId) !==
            principal.sessionId)
      )
        throw new Error("Run ID already in use");
      if (duplicate.requestFingerprint !== signature)
        throw new Error("Run request ID was reused with different input");
      return { run: duplicate, created: false };
    }
    if (
      !current.definitions.some(
        (item) => item.id === definition.id && item.updatedAt === definition.updatedAt,
      )
    )
      throw new Error("Crew changed during model discovery. Reload before starting.");
    let linkedTaskId = sourceTaskId;
    if (!linkedTaskId) {
      linkedTaskId = `crew-${requestId}`;
      const review = reviewedThread();
      const origin = review
        ? { kind: "task" as const, id: linkedTaskId, projectId, threadId: review.threadId }
        : undefined;
      if (origin) await onAssistantTaskOrigin?.({ ...origin, state: "pending" });
      const createdTask = await tasks.save({
        id: linkedTaskId,
        expectedAbsent: true,
        projectId,
        title: crewWorkTitle(prompt) || definition.name,
        prompt,
        harness: selected.candidate.harness,
        model: selected.candidate.model,
        modelSettings: selected.candidate.modelSettings ?? {},
        runtimeMode: mode ?? "supervised",
        crewDefinitionId: definitionId,
        isolate: false,
        review: false,
        status: "queued",
      });
      await tasks.reserveCrewExecution(linkedTaskId, requestId);
      if (origin)
        await onAssistantTaskOrigin?.({
          ...origin,
          state: "completed",
          entityCreatedAt: createdTask.createdAt,
        });
    }
    const run: CrewRun = {
      id: requestId,
      projectId,
      definition: structuredClone(definition),
      status: "active",
      coordinatorSessionId: newConversation ? undefined : principal?.sessionId,
      ...(newConversation && principal ? { requestedBySessionId: principal.sessionId } : {}),
      sourceTaskId: linkedTaskId,
      coordinatorCandidate: selected.candidate,
      ...(routingWait ? { routingWait, error: selected.reason } : {}),
      ...(crewWorkTitle(prompt) ? { title: crewWorkTitle(prompt) } : {}),
      assignments: [],
      messages: [],
      notifications: {},
      ...(!principal || newConversation
        ? { launch: { candidate: selected.candidate, runtimeMode: mode ?? "supervised", prompt } }
        : {}),
      requestFingerprint: signature,
      createdAt: now(),
      updatedAt: now(),
    };
    if (principal && !newConversation) {
      await checkOperationAuthority();
      if (
        current.runs.some(
          (r) => r.status !== "finished" && r.coordinatorSessionId === principal.sessionId,
        )
      )
        throw new Error("This conversation already coordinates a crew");
    }
    current.runs.push(run);
    await write(current);
    return { run, created: true };
  });
}
