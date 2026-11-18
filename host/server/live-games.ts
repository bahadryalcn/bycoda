import { join } from "node:path";
import { LiveGamesService } from "../live-games/service";
import { osSecretValues } from "../secrets/secret-store";
import type { ServerBindings } from "./bindings";

export function createLiveGamesRuntime(
  dependencies: Pick<ServerBindings, "featureDirectory" | "engine">,
  port: () => number,
) {
  const directory = join(dependencies.featureDirectory, "live-games");
  return new LiveGamesService({
    directory, port, secrets: osSecretValues(directory, dependencies.engine.store.environmentId),
  });
}
