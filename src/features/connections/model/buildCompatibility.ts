import type { HostDescriptor } from "./protocol";
import type { BuildIdentity } from "../../workspaces/model/contracts";

const managedCapabilities = ["workspaces.managed.v1", "workspaces.policy.v1"];

/** Compare the bundled Host component, not semver or whole-app timestamps. */
export function localHostCompatibility(app: BuildIdentity | null, host: HostDescriptor) {
  if (managedCapabilities.some((capability) => !host.capabilities.includes(capability)))
    return "capabilities" as const;
  if (app && host.buildIdentity && app.components.host !== host.buildIdentity.components.host)
    return "identity" as const;
  return null;
}
