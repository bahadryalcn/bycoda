import { join } from "node:path";
import { LiveGamesService } from "../live-games/service";
import { osSecretValues } from "../secrets/secret-store";
import type { SocialLiveService } from "../social/core/social-live";
import type { ServerBindings } from "./bindings";

export function createLiveGamesRuntime(
  dependencies: Pick<ServerBindings, "featureDirectory" | "engine">,
  port: () => number,
  social: () => SocialLiveService,
) {
  const directory = join(dependencies.featureDirectory, "live-games");
  return new LiveGamesService({
    directory,
    port,
    social,
    secrets: osSecretValues(directory, dependencies.engine.store.environmentId),
  });
}
