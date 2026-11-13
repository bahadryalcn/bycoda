import { vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import type { HostEngine, EngineCommandAdmission } from "../engine";
import type { HostStore } from "../store";
import type { HostCommand } from "../../src/features/connections/model/protocol";
import type { HostCrews } from "./crews";
import type { HostTasks } from "../tasks/tasks";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import { composeCommandAdmission } from "../execution/command-admission";

/** Keep focused fake engines inside real Work admission and durable receipt recovery. */
export function wireCrewWorkEngine(store: HostStore, engine: Pick<HostEngine, "command">): void {
  if (!vi.isMockFunction(engine.command)) throw new Error("Crew fixture command must be a mock.");
  const command = engine.command.getMockImplementation();
  if (!command) throw new Error("Crew fixture command effect is missing.");
  const admissions = new AsyncLocalStorage<EngineCommandAdmission>();
  const originals = new Map<string, string>();
  engine.command.mockImplementation(async (raw) => {
    const input = raw as HostCommand;
    const admission = admissions.getStore();
    if (input.type !== "cancel")
      await admission?.check({
        phase: "command",
        sessionId: "sessionId" in input ? (input.sessionId ?? "") : "",
      });
    const previous = await store.receipt(input.commandId, JSON.stringify(input));
    if (previous) return previous;
    if (input.type === "send")
      await admission?.check({ phase: "provider", sessionId: input.sessionId });
    const result = await command(input);
    if (input.type !== "create" && input.type !== "send") return result;
    const current = input.type === "send" ? await store.session(result.sessionId) : undefined;
    if (input.type === "send" && !current?.runId)
      throw new Error("Crew fixture send did not establish an exact original run.");
    const receipt = {
      ...result,
      commandId: input.commandId,
      ...(current?.runId ? { runId: current.runId } : {}),
    };
    // Only the exact effect already accepted above survives a revoked waiter.
    await store.db.runRecoveryBookkeeping(() =>
      store.recordReceipt(JSON.stringify(input), receipt),
    );
    if (receipt.runId) {
      originals.set(`${receipt.sessionId}:${receipt.runId}`, input.commandId);
      await admission?.onAccepted?.(receipt);
    }
    return receipt;
  });
  Object.assign(engine, {
    withCommandAdmission: <T>(admission: EngineCommandAdmission, action: () => Promise<T>) =>
      admissions.run(composeCommandAdmission(admissions.getStore(), admission), action),
    waitForRun: vi.fn(async (sessionId: string, runId: string) => {
      if (!originals.has(`${sessionId}:${runId}`))
        throw new Error("Crew fixture has no evidence for this original run.");
      const current = await store.session(sessionId);
      if (current.runId !== runId || current.status === "running")
        throw new Error("Crew fixture original run has not retired.");
    }),
  });
}

/** Minimal scheduler for focused Crew fixtures; source work stays separate from assignments. */
export function wireCrewSourceTasks(crews: HostCrews, tasks: HostTasks, store: HostStore) {
  const sources: HostTask[] = [];
  const list = tasks.list.bind(tasks);
  const save = tasks.save?.bind(tasks);
  const tick = tasks.tick.bind(tasks);
  tasks.list = vi.fn(async (projectId?: string) => [
    ...(await list(projectId)),
    ...sources.filter((task) => !projectId || task.projectId === projectId),
  ]);
  tasks.save = vi.fn(async (raw: unknown) => {
    const task = raw as HostTask;
    if (!task.id.startsWith("crew-")) {
      if (!save) throw new Error("Fixture does not implement assignment writes.");
      return save(raw);
    }
    sources.push({ ...task, status: "queued" });
    return task;
  });
  tasks.reserveCrewExecution = vi.fn(async (id, runId) => {
    sources.find((task) => task.id === id)!.crewExecutionId = runId;
  });
  tasks.startTask = vi.fn(async (id) => sources.find((task) => task.id === id)!);
  tasks.tick = vi.fn(async () => {
    for (const task of sources.filter((entry) => entry.status === "queued")) {
      const run = await crews.startRun(
        task.projectId,
        task.crewDefinitionId!,
        task.prompt,
        task.crewExecutionId!,
        task.runtimeMode,
        undefined,
        false,
        task.id,
      );
      task.status = "running";
      task.sessionId = run.coordinatorSessionId;
    }
    // Canonical assignment drain owns its scope; coordinator launch above retains its caller gates.
    await store.db.outsideScope(tick);
  });
  return {
    finish: () => {
      for (const task of sources) task.status = "done";
    },
    remove: () => {
      sources.splice(0);
    },
  };
}
