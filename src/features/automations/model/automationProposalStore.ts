import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../connections/model/connections";
import type { HostProject, RemoteMachine } from "../../connections/model/protocol";
import { parseRemotePath } from "../../connections/model/remoteProjects";
import { pathKey } from "../../../shared/lib/paths";
import type { Session } from "../../sessions/model/session";
import { taskMachineFor } from "../../tasks/model/taskClient";
import { HOST_AUTOMATION_PROJECT_TASKS, HOST_AUTOMATION_ROOM } from "./hostAutomations";
import {
  AutomationsProposeResultSchema,
  AutomationSavePayloadSchema,
  HostAutomationSchema,
  type AutomationProposal,
  type HostAutomation,
} from "../../../shared/model/host-contracts/automations";

type ProposalState = {
  session: Session;
  request: string;
  operationId: string;
  automationId: string;
  status: "preparing" | "review" | "saving" | "saved" | "failed";
  machine?: RemoteMachine;
  proposal?: AutomationProposal;
  saved?: HostAutomation;
  error?: string;
  /** Once dispatched, retries inspect the same ID before any create-only send. */
  saveAttempted?: boolean;
  saveInput?: ReturnType<typeof AutomationSavePayloadSchema.parse>;
};
const RECEIPT_PREFIX = "bycoda.automation-proposal.creation.v1:";
let state: ProposalState | null = null;
const listeners = new Set<() => void>();
const publish = (next: ProposalState | null) => {
  state = next;
  for (const listener of listeners) listener();
};
export const automationProposalSnapshot = () => state;
export function subscribeAutomationProposal(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Open synchronously so submit preserves the original composer draft and attachments. */
export function openAutomationProposal(session: Session, request: string): boolean {
  if (state) return false;
  let pending: string | null;
  try {
    const key = Object.keys(window.localStorage).find((key) => key.startsWith(RECEIPT_PREFIX));
    pending = key ? window.localStorage.getItem(key) : null;
  } catch {
    publish({
      session: structuredClone(session),
      request,
      operationId: "unresolved",
      automationId: "",
      status: "failed",
      error: "Automation creation receipts are unavailable. No new automation was created.",
    });
    return true;
  }
  if (pending) {
    try {
      const receipt = JSON.parse(pending);
      const proposal = AutomationsProposeResultSchema.parse(receipt.proposal);
      const input = AutomationSavePayloadSchema.parse(receipt.input);
      if (
        typeof receipt.machine?.id !== "string" ||
        typeof receipt.machine?.environmentId !== "string" ||
        typeof receipt.cwd !== "string" ||
        typeof receipt.sessionId !== "string"
      )
        throw new Error("Invalid original automation target.");
      const visible = {
        name: proposal.name,
        prompt: proposal.instruction,
        projectId: proposal.outputTarget === "room" ? "" : proposal.projectId,
        ...proposal.schedule,
      };
      if (
        !input.id ||
        Object.entries(visible).some(([key, value]) => input[key as keyof typeof input] !== value)
      )
        throw new Error("Automation receipt does not match its reviewed proposal.");
      publish({
        session: { ...structuredClone(session), id: receipt.sessionId, cwd: receipt.cwd },
        request,
        operationId: proposal.operationId,
        automationId: input.id,
        status: "review",
        machine: receipt.machine,
        proposal,
        saveAttempted: true,
        saveInput: input,
      });
    } catch {
      publish({
        session: structuredClone(session),
        request,
        operationId: "unresolved",
        automationId: "",
        status: "failed",
        error:
          "The original automation creation receipt could not be read. No new automation was created.",
      });
    }
    return true;
  }
  const original: ProposalState = {
    session: structuredClone(session),
    request,
    operationId: crypto.randomUUID(),
    automationId: crypto.randomUUID(),
    status: "preparing",
  };
  publish(original);
  void prepare(original).catch((error: unknown) => {
    if (state?.operationId === original.operationId)
      publish({
        ...state,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
  });
  return true;
}

async function prepare(original: ProposalState) {
  const machines = await invoke<RemoteMachine[]>("remote_machines");
  const binding = original.session.hostBinding;
  const machine = structuredClone(
    taskMachineFor(machines, original.session.cwd, binding?.machineId),
  );
  if (!machine.environmentId || (binding && binding.environmentId !== machine.environmentId))
    throw new Error("The original conversation Host changed. No automation was created.");
  // Read the captured owner directly; project discovery must not register a project on a replacement Host.
  const projects = await remoteRequest<HostProject[]>(
    machine.id,
    "projects.list",
    {},
    false,
    true,
    machine.environmentId,
  );
  const hostPath = parseRemotePath(original.session.cwd)?.hostPath ?? original.session.cwd;
  const project = projects.find((entry) => pathKey(entry.cwd) === pathKey(hostPath));
  if (!project)
    throw new Error("The original conversation project is unavailable. No automation was created.");
  if (binding && binding.projectId !== project.id)
    throw new Error("The original conversation project changed. No automation was created.");
  if (state?.operationId !== original.operationId) return;
  const proposal = AutomationsProposeResultSchema.parse(
    await remoteRequest(
      machine.id,
      "automations.propose",
      {
        operationId: original.operationId,
        request: original.request,
        projectId: project.id,
        currentExecution: {
          harness: original.session.harness,
          model: original.session.model,
          modelSettings: original.session.modelSettings,
        },
      },
      false,
      true,
      machine.environmentId,
    ),
  );
  if (proposal.operationId !== original.operationId || proposal.projectId !== project.id)
    throw new Error("The automation proposal does not match its original request.");
  const capability =
    proposal.outputTarget === "room" ? HOST_AUTOMATION_ROOM : HOST_AUTOMATION_PROJECT_TASKS;
  const description = await remoteRequest<{ capabilities?: string[] }>(
    machine.id,
    "environment.describe",
    {},
    false,
    true,
    machine.environmentId,
  );
  if (!description.capabilities?.includes(capability))
    throw new Error("Update this Host to support the proposed automation output.");
  if (state?.operationId === original.operationId)
    publish({ ...original, machine, proposal, status: "review" });
}

export function closeAutomationProposal() {
  if (state?.status !== "saving") publish(null);
}

/** Only an owner click enters creation. Captured Host, project and payload never follow UI selection. */
export async function saveAutomationProposal() {
  const original = state;
  if (!original?.proposal || !original.machine || !["review", "failed"].includes(original.status))
    return;
  const { proposal, machine, session } = original;
  const automation = original.saveInput ?? {
    id: original.automationId,
    name: proposal.name,
    prompt: proposal.instruction,
    projectId: proposal.outputTarget === "room" ? "" : proposal.projectId,
    ...proposal.schedule,
    harness: session.harness,
    model: session.model,
    ...(session.providerAccountId ? { providerAccountId: session.providerAccountId } : {}),
    modelSettings: session.modelSettings,
    runtimeMode: session.runtimeMode,
    modelChoice: { kind: "default" as const },
    enabled: true,
  };
  publish({ ...original, status: "saving", error: undefined, saveAttempted: true });
  try {
    // Persist the exact create-only input before transport. Reload/reopen recovers this receipt,
    // not a new ID or the latest session/model/Host selection. Storage failure sends nothing.
    window.localStorage.setItem(
      `${RECEIPT_PREFIX}${automation.id}`,
      JSON.stringify({
        machine,
        proposal,
        input: automation,
        sessionId: session.id,
        cwd: session.cwd,
      }),
    );
    let saved: HostAutomation | undefined;
    if (original.saveAttempted) {
      const rows = await remoteRequest<HostAutomation[]>(
        machine.id,
        "automations.list",
        {},
        false,
        true,
        machine.environmentId,
      );
      const previous = rows.find((row) => row.id === automation.id);
      if (previous) {
        if (
          Object.entries(automation).some(
            ([key, value]) =>
              JSON.stringify(previous[key as keyof HostAutomation]) !== JSON.stringify(value),
          )
        )
          throw new Error(
            "The original automation creation has a conflicting receipt. No replacement was created.",
          );
        saved = HostAutomationSchema.parse(previous);
      }
    }
    saved ??= HostAutomationSchema.parse(
      await remoteRequest(
        machine.id,
        "automations.save",
        {
          automation: { ...automation, expectedAbsent: true },
        },
        false,
        true,
        machine.environmentId,
      ),
    );
    const acknowledged = saved;
    if (
      Object.entries(automation).some(
        ([key, value]) =>
          JSON.stringify(acknowledged[key as keyof HostAutomation]) !== JSON.stringify(value),
      )
    )
      throw new Error(
        "The automation creation acknowledgement does not match the original target.",
      );
    window.localStorage.removeItem(`${RECEIPT_PREFIX}${automation.id}`);
    if (state?.operationId === original.operationId)
      publish({ ...original, status: "saved", saved, saveAttempted: true, saveInput: automation });
  } catch (error) {
    if (state?.operationId === original.operationId)
      publish({
        ...original,
        status: "failed",
        saveInput: automation,
        saveAttempted: true,
        error: error instanceof Error ? error.message : String(error),
      });
  }
}
