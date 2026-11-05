import { join } from "node:path";
import { HostCrews } from "../crews/crews";
import { createCrewImageCapabilityProbe } from "../domains/crews/image-capability";
import { probeNativeCodexImageCapability } from "../social/social-images";
import type { ServerBindings } from "./bindings";
export function createCrewsRuntime(
  dependencies: Pick<
    ServerBindings,
    | "featureDirectory"
    | "engine"
    | "tasks"
    | "models"
    | "featureMeta"
    | "desktopWatch"
    | "commandService"
  >,
) {
  const imageCapability = createCrewImageCapabilityProbe({
    probe: (authorize) =>
      probeNativeCodexImageCapability(join(dependencies.featureDirectory, "crews"), authorize),
  });
  const crews = new HostCrews(
    dependencies.engine.store,
    dependencies.engine,
    dependencies.tasks,
    async (projectId) => await dependencies.models(projectId),
    Date.now,
    imageCapability,
    {
      session: async (id) => {
        const value = await dependencies.featureMeta(id);
        const native = await dependencies.desktopWatch(id);
        return native?.running ? { ...value, status: "running", runId: "desktop" } : value;
      },
      command: (command, context) => dependencies.commandService.dispatch(command, context),
    },
  );
  return { imageCapability, crews };
}
