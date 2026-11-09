import { join } from "node:path";
import { HostCrews } from "../crews/crews";
import { createCrewImageCapabilityProbe } from "../domains/crews/image-capability";
import { antigravityImagesAvailable } from "../images/image-models";
import {
  configuredImageProviderAvailable,
  probeNativeCodexImageCapability,
} from "../social/social-images";
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
    // Every member can call images.generate, so any Host provider counts.
    probe: async (authorize) => {
      const directory = join(dependencies.featureDirectory, "crews");
      return (await configuredImageProviderAvailable(directory, authorize))
        ? { available: true }
        : await probeNativeCodexImageCapability(directory, authorize);
    },
    native: async (harness) => harness === "antigravity" && (await antigravityImagesAvailable()),
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
