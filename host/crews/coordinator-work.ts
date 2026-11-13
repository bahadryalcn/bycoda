import { readSessionWorkReceipt } from "../work/session-adapter";
import { createHash } from "node:crypto";
import type { CrewRun } from "../../src/features/crews/model/crew";
import { launchGeneration } from "./crew-managed-session";
import type { HostStore } from "../store";
import type { CrewSessionPorts } from "./crew-ports";
import { launchSessionRun, type SessionRunEngine } from "../sessions/sessionRuns";

/** Match a retained coordinator launch, including its original payload. */
export function matchesCrewLaunch(current: CrewRun, owned: CrewRun): boolean {
  const fingerprint = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return (
    current.id === owned.id &&
    current.projectId === owned.projectId &&
    current.createdAt === owned.createdAt &&
    current.requestFingerprint === owned.requestFingerprint &&
    current.launch !== undefined &&
    owned.launch !== undefined &&
    fingerprint(current.launch) === fingerprint(owned.launch)
  );
}

/** Coordinator notifications are executable turns; waiting parents own no slot. */
export async function launchCrewCoordinatorTurn(
  store: HostStore,
  engine: SessionRunEngine,
  run: {
    id: string;
    projectId: string;
    coordinatorSessionId?: string;
    pendingDelivery?: { commandId: string; text: string };
  },
  admitted: () => Promise<boolean>,
  coordinatorSession: (id: string, projectId: string) => ReturnType<CrewSessionPorts["session"]>,
) {
  if (!run.pendingDelivery || !run.coordinatorSessionId)
    throw new Error("Crew coordinator delivery is missing its original identity.");
  const target = (await coordinatorSession(run.coordinatorSessionId, run.projectId)).session;
  return launchSessionRun(
    store,
    engine,
    {
      projectId: run.projectId,
      harness: target.harness,
      model: target.model,
      providerAccountId: target.providerAccountId,
      modelSettings: target.modelSettings,
      runtimeMode: target.runtimeMode,
      title: target.title,
      resumeSessionId: run.coordinatorSessionId,
      work: { kind: "crew.coordinator", id: run.id, occurrence: run.pendingDelivery.commandId },
      prompt: run.pendingDelivery.text,
    },
    admitted,
  );
}

/** Re-enter the original occurrence; the Work adapter keeps unknown dispatch held. */
export async function crewCoordinatorLaunchPending(
  store: HostStore,
  run: { id: string; notifications: Record<string, string> },
): Promise<boolean> {
  const original = await readSessionWorkReceipt(store, {
    kind: "crew.coordinator",
    id: run.id,
    occurrence: String(launchGeneration(run) ?? run.id),
  });
  return original.exists && !original.receipt;
}
