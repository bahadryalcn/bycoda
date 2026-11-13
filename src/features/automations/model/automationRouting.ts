import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../connections/public/connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import { isRemoteProvider, type RemoteMachine } from "../../connections/public/protocol";
import { resolveModelRouting } from "../../model-routing/public/choice";
import {
  HOST_MODEL_ROUTING,
  ModelRoutingGetResultSchema,
} from "../../../shared/model/host-contracts/model-routing";
import { machineCapabilities } from "./machineSnapshot";
import type { Automation, AutomationRun } from "./automations";

/** Desktop runs always resolve on this computer; background forms use their execution Host. */
export async function automationRoutingHost(machineId?: string) {
  const machines = await invoke<RemoteMachine[]>("remote_machines");
  const machine = machines?.find(
    machineId ? (entry) => entry.id === machineId : isLocalSyncMachine,
  );
  if (!machine) return { machineId: undefined, supported: false };
  const capabilities = await machineCapabilities(machine);
  return { machineId: machine.id, supported: capabilities.includes(HOST_MODEL_ROUTING) };
}

/** Resolve once before creating a session. Offline/old Hosts retain the saved concrete fallback. */
export async function resolveAutomationLaunch(automation: Automation, run: AutomationRun) {
  let execution = run.execution;
  let maxRunMinutes = run.maxRunMinutes ?? automation.maxRunMinutes ?? 0;
  let skip: string | undefined;
  if (!run.sessionId && !execution && isRemoteProvider(automation.harness)) {
    try {
      const host = await automationRoutingHost();
      if (host.supported && host.machineId) {
        const resolution = await resolveModelRouting(host.machineId, {
          role: "automation",
          choice: automation.modelChoice ?? { kind: "fixed" },
          fixed: {
            harness: automation.harness,
            providerAccountId: automation.providerAccountId,
            model: automation.model,
            modelSettings: automation.modelSettings ?? {},
          },
        });
        if (resolution.ok)
          execution = {
            ...resolution.target,
            ...(resolution.source.kind !== "fixed" && !resolution.target.providerAccountId
              ? { providerAccountId: "default" }
              : {}),
          };
        else if (resolution.reason === "noEligibleEntry")
          skip = `Skipped: no eligible automation model (${resolution.skipped.map((entry) => `${entry.entryId}: ${entry.reason}`).join(", ")}).`;
        if (!maxRunMinutes) {
          const state = await remoteRequest(host.machineId, "modelRouting.get", {})
            .then((result) => ModelRoutingGetResultSchema.parse(result).state)
            .catch(() => undefined);
          maxRunMinutes = state?.defaultMaxRunMinutes ?? 0;
        }
      }
    } catch {
      // Routing is optional on the desktop: an unreachable Host keeps the stored model.
    }
    if (!skip)
      execution ??= {
        harness: automation.harness,
        providerAccountId: automation.providerAccountId,
        model: automation.model,
        modelSettings: automation.modelSettings ?? {},
      };
  }
  return {
    automation: execution ? { ...automation, ...execution, maxRunMinutes } : automation,
    execution,
    maxRunMinutes,
    skip,
  };
}
