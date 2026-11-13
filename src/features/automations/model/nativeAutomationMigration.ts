import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../connections/public/connections";
import { parseRemotePath } from "../../connections/public/remoteProjects";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { HostProject, RemoteMachine } from "../../connections";
import { NativeAutomationMigrationSchema } from "../../../shared/model/host-contracts/automations";
import type { z } from "zod";
import type { Automation } from "./automations";
import type { HostAutomation } from "./hostAutomations";

export type NativeAutomationMigrationReceipt = z.infer<typeof NativeAutomationMigrationSchema>;
export type NativeAutomationMigrationResult = {
  migrated: string[];
  blocked: Array<{ automationId: string; reason: string }>;
};
const pending = new Map<string, Promise<NativeAutomationMigrationResult>>();

/** Resume retained receipts before considering new native definitions. No native deletion. */
export function migrateNativeAutomations(
  machine: RemoteMachine,
  projectFor: (cwd: string) => Promise<HostProject>,
): Promise<NativeAutomationMigrationResult> {
  const current = pending.get(machine.environmentId);
  if (current) return current;
  const operation = migrate(machine, projectFor).finally(() =>
    pending.delete(machine.environmentId),
  );
  pending.set(machine.environmentId, operation);
  return operation;
}

async function migrate(
  machine: RemoteMachine,
  projectFor: (cwd: string) => Promise<HostProject>,
): Promise<NativeAutomationMigrationResult> {
  const [definitions, receipts] = await Promise.all([
    invoke<Automation[]>("automations_list"),
    invoke<NativeAutomationMigrationReceipt[]>("automations_host_migrations_list"),
  ]);
  const result: NativeAutomationMigrationResult = { migrated: [], blocked: [] };
  const owned = (cwd: string) => {
    const remote = parseRemotePath(cwd);
    return remote ? remote.environmentId === machine.environmentId : isLocalSyncMachine(machine);
  };
  const sources = new Map(
    definitions.filter((item) => owned(item.cwd)).map((item) => [item.id, item]),
  );
  for (const receipt of receipts) {
    if (receipt.targetHostId !== machine.environmentId) continue;
    try {
      const snapshot = JSON.parse(receipt.snapshot) as { automation: Automation };
      sources.set(receipt.automationId, snapshot.automation);
    } catch (error) {
      result.blocked.push({
        automationId: receipt.automationId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  for (const source of sources.values()) {
    try {
      let receipt = receipts.find(
        (item) => item.automationId === source.id && item.targetHostId === machine.environmentId,
      );
      if (!receipt && !isLocalSyncMachine(machine))
        throw new Error(
          "Native schedules use this computer's time zone. Remote Host migration requires explicit time zone support; the original schedule was retained.",
        );
      receipt ??= await invoke<NativeAutomationMigrationReceipt>("automations_host_prepare", {
        automationId: source.id,
        targetHostId: machine.environmentId,
      });
      const snapshot = JSON.parse(receipt.snapshot) as { automation: Automation };
      const original = snapshot.automation;
      const project = await projectFor(original.cwd);
      const trigger = original.triggers?.[0];
      const payload = {
        id: original.id,
        name: original.name,
        prompt: original.prompt,
        projectId: project.id,
        harness: original.harness,
        providerAccountId: original.providerAccountId,
        modelChoice: original.modelChoice,
        model: original.model,
        modelSettings: original.modelSettings ?? {},
        runtimeMode: original.runtimeMode,
        scheduleKind: trigger?.scheduleKind ?? original.scheduleKind,
        minute: trigger?.minute ?? original.minute,
        time: trigger?.time ?? original.time,
        dayOfWeek: trigger?.dayOfWeek ?? original.dayOfWeek,
        maxRunMinutes: original.maxRunMinutes ?? 0,
        maxRunsPerDay: original.maxRunsPerDay ?? 0,
        missedRunGraceMinutes: original.missedRunGraceMinutes,
        enabled: original.enabled,
      };
      // A committed native receipt can still need its original prepared Host import
      // after a lost response. Prepared replay never downgrades committed Host state.
      const imported = await remoteRequest<HostAutomation>(
        machine.id,
        "automations.save",
        {
          automation: { ...payload, nativeMigration: { ...receipt, phase: "prepared" } },
        },
        false,
        true,
        machine.environmentId,
      );
      if (receipt.phase !== "committed")
        receipt = await invoke<NativeAutomationMigrationReceipt>("automations_host_commit", {
          automationId: source.id,
          receipt: receipt.receipt,
          targetHostId: machine.environmentId,
          hostAutomationId: imported.id,
        });
      await remoteRequest(
        machine.id,
        "automations.save",
        { automation: { ...payload, nativeMigration: receipt } },
        false,
        true,
        machine.environmentId,
      );
      result.migrated.push(source.id);
    } catch (error) {
      result.blocked.push({
        automationId: source.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
