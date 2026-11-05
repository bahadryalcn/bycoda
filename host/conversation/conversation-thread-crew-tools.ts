import { ConversationManagementTools, type ManagementPorts } from "./conversation-management-tools";
import type { HostCrews } from "../crews/crews";
import type { AssistantThreadPrincipal } from "../sessions/session-authority";

export const THREAD_CREW_READS = new Set([
  "crews.list",
  "crews.schema",
  "crews.inspect",
  "crews.get",
  "crews.definitions.list",
  "crews.definition.get",
  "crews.agents.list",
  "crews.agent.get",
  "crews.runs.list",
]);
export const THREAD_CREW_WRITES = new Set([
  "crews.save",
  "crews.agent.save",
  "crews.start",
  "crews.assign",
  "crews.request",
  "crews.resolve",
  "crews.pause",
  "crews.stop",
  "crews.resume",
  "crews.accept",
  "crews.finish",
]);
export const threadCrewAction = (action: string) =>
  THREAD_CREW_READS.has(action) || THREAD_CREW_WRITES.has(action);

/** operationId is distinct from a crew run/request ID, which may identify existing work. */
export const threadCrewReviewFields = {
  operationId: { type: "string", minLength: 1, maxLength: 200 },
  expectedRevision: { type: "string", pattern: "^[a-f0-9]{64}$" },
};

type Ports = Omit<ManagementPorts<string, AssistantThreadPrincipal>, "execute">;
export class ConversationThreadCrewTools {
  private readonly management: ConversationManagementTools<string, AssistantThreadPrincipal>;
  constructor(
    private readonly crews: HostCrews,
    ports: Ports,
  ) {
    this.management = new ConversationManagementTools<string, AssistantThreadPrincipal>(
      {
        ...ports,
        execute: async (action, input, principal, authorized) => {
          const original = input.crewInput as Record<string, unknown>;
          return crews.withAuthorization(authorized, () =>
            crews.callReviewedAssistantThread(
              action,
              original,
              principal,
              String(original.expectedRevision),
            ),
          );
        },
      },
      new Set(),
    );
  }
  async call(
    action: string,
    input: Record<string, unknown>,
    principal: AssistantThreadPrincipal,
    authorized: () => Promise<boolean>,
    qualify: <T>(effect: () => Promise<T>) => Promise<T> = (effect) => effect(),
  ) {
    if (!threadCrewAction(action))
      throw new Error("This Crew action keeps its existing owner workflow.");
    if (THREAD_CREW_READS.has(action)) {
      return qualify(() =>
        this.crews.withAuthorization(authorized, async () => {
          const result = await this.crews.readForAssistantThread(
            action,
            input,
            principal.projectId,
          );
          if (!(await authorized())) throw new Error("Conversation authority revoked.");
          return result;
        }),
      );
    }
    if (
      typeof input.operationId !== "string" ||
      !input.operationId ||
      input.operationId.length > 200
    )
      throw new Error(
        "A stable Crew operationId is required; it is separate from the run/request ID.",
      );
    if (
      typeof input.expectedRevision !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.expectedRevision)
    )
      throw new Error("Read the Crew state and retain its expectedRevision before a change.");
    return this.management.call(
      action,
      {
        requestId: input.operationId,
        crewInput: input,
      },
      principal,
      authorized,
      qualify,
    );
  }
}
