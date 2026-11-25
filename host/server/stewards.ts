import { HostStewards } from "../stewards/stewards";
import type { ServerBindings } from "./bindings";
export async function createStewardsRuntime(
  dependencies: Pick<ServerBindings, "stewardsOverride" | "engine" | "tasks" | "automations">,
  publish: (runtime: Awaited<ReturnType<typeof createStewardsRuntime>>) => void,
) {
  publish({
    get stewards() {
      return stewards;
    },
  });

  const stewards =
    dependencies.stewardsOverride ??
    new HostStewards(dependencies.engine.store, dependencies.engine, dependencies.tasks);
  await stewards.ready;
  await stewards.bindAutomations(dependencies.automations);
  return { stewards };
}
