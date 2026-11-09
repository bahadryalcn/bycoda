import type { DevServerDetails } from "../../src/features/host-tools/devServerTypes";
import { DevServerAccess } from "../dev-servers/dev-server-access";
import { WebControl } from "../web/web-control";
import type { ServerBindings } from "./bindings";
export function createDevelopmentRuntime(
  dependencies: Pick<ServerBindings, "engine" | "devServers" | "server">,
) {
  const devServerAccess = new DevServerAccess(
    async (params) => {
      await dependencies.engine.store.project(String(params.projectId ?? ""));
      return (await dependencies.devServers.handle(
        "devServers.details",
        params,
        (await dependencies.engine.store.projects()).map((project) => ({
          id: project.id,
          name: project.name,
          path: project.cwd,
        })),
      )) as DevServerDetails;
    },
    () => {
      const address = dependencies.server.address();
      return address && typeof address !== "string" ? address.port : undefined;
    },
  );
  const refreshLogSources = async () => {
    void dependencies.devServers
      .refreshLogSources(
        (await dependencies.engine.store.projects()).map((project) => ({
          id: project.id,
          name: project.name,
          path: project.cwd,
        })),
      )
      .catch(() => {});
  };
  const webControl = process.env.BYCODA_WEB_CONTROL_ORIGIN
    ? new WebControl(process.env.BYCODA_WEB_CONTROL_ORIGIN)
    : undefined;
  return { devServerAccess, refreshLogSources, webControl };
}
