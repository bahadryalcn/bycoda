import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../connections/model/connections";
import type { HostDescriptor, HostSession, RemoteMachine } from "../../connections/model/protocol";
import type { HostGoal } from "../../tasks/model/hostGoals";
import {
  HostAutomationSchema,
  type HostAutomation,
} from "../../../shared/model/host-contracts/automations";
import {
  AssistantResponseValidationSchema,
  type AssistantSnapshot,
} from "../../../shared/model/host-contracts/assistant";

/** Finite owner metadata reads. No model-supplied methods, writes or target switching. */
export type AssistantHostRead = {
  environmentId: string;
  goals(): Promise<HostGoal[]>;
  automations(): Promise<HostAutomation[]>;
  session(sessionId: string): Promise<HostSession>;
  projects(): Promise<{ id: string; path: string; name: string }[]>;
  snapshot(): Promise<AssistantSnapshot>;
};
export async function captureAssistantHostRead(
  expectedEnvironmentId?: string,
): Promise<AssistantHostRead> {
  const machine = await invoke<RemoteMachine | null>("local_host_connect");
  if (
    !machine?.id ||
    !machine.environmentId ||
    (expectedEnvironmentId && machine.environmentId !== expectedEnvironmentId)
  )
    throw new Error("The captured Host is no longer available. Retry its original connection.");
  const { id, environmentId } = machine;
  const descriptor = await remoteRequest<HostDescriptor>(
    id,
    "environment.describe",
    {},
    false,
    false,
    environmentId,
  );
  if (!descriptor || descriptor.environmentId !== environmentId)
    throw new Error("The captured Host connection changed. Retry its original connection.");
  if (!Array.isArray(descriptor.capabilities) || !descriptor.capabilities.includes("assistant.v1"))
    throw new Error("Update bycoda Host on the selected computer to use this feature.");
  const read = <T>(
    method: "goals.list" | "sessions.get" | "assistant.request" | "automations.list",
    params: Record<string, unknown>,
  ) => remoteRequest<T>(id, method, params, false, false, environmentId);
  return Object.freeze({
    environmentId,
    goals: () => read<HostGoal[]>("goals.list", {}),
    automations: async () => {
      const rows = await read<unknown>("automations.list", {});
      if (!Array.isArray(rows)) throw new Error("The linked automation is unavailable.");
      return rows.map((row) => HostAutomationSchema.parse(row));
    },
    session: (sessionId: string) => {
      if (!sessionId || sessionId.length > 200)
        return Promise.reject(new Error("Invalid session identity."));
      return read<HostSession>("sessions.get", { sessionId, preview: true, summary: true });
    },
    projects: async () => {
      const response = AssistantResponseValidationSchema.parse(
        await read("assistant.request", { op: "projects.list" }),
      );
      if (!response.projects)
        throw new Error("Project visibility could not be verified. Retry loading projects.");
      return response.projects;
    },
    snapshot: async () => {
      const response = AssistantResponseValidationSchema.parse(
        await read("assistant.request", { op: "snapshot", limit: 100 }),
      );
      if (!response.snapshot) throw new Error("The current assistant state is unavailable.");
      return response.snapshot;
    },
  });
}
