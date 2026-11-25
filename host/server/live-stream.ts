import { join } from "node:path";
import { LiveStreamService } from "../live-stream/service";
import { osSecretValues } from "../secrets/secret-store";
import type { SocialLiveService } from "../social/core/social-live";
import type { ServerBindings } from "./bindings";

export function createLiveStreamRuntime(
  dependencies: Pick<ServerBindings, "featureDirectory" | "engine">,
  social: () => SocialLiveService,
) {
  const directory = join(dependencies.featureDirectory, "live-stream");
  return new LiveStreamService({
    directory,
    social,
    secrets: osSecretValues(directory, dependencies.engine.store.environmentId),
  });
}
