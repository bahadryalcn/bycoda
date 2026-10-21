import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { machineProjects } from "../../automations/model/machineSnapshot";
import { pathKey } from "../../../shared/lib/paths";
import { remoteRequest } from "../model/connections";
import { parseRemotePath } from "../model/remoteProjects";
import type {
  HostDescriptor,
  HostModelCatalog,
  RemoteMachine,
  RemoteProvider,
} from "../model/protocol";
import { requireHostDescriptor } from "../model/protocol";
import { remoteModelControls } from "../model/remoteModels";
import type { HarnessId } from "../../sessions/model/session";
import type { AgentModel } from "../../sessions/model/models";
import {
  LOCAL_MODEL_SOURCE,
  ModelSourceContext,
  type ModelSource,
} from "../../sessions/ui/modelSource";

export function hostModelSource(
  id: string,
  descriptor: HostDescriptor | undefined,
  catalog: HostModelCatalog | undefined,
  savedModel: string,
  savedSettings: Record<string, string>,
  refresh: () => void,
): ModelSource {
  const modelsFor = (harness: HarnessId) => catalog?.models[harness as RemoteProvider] ?? [];
  return {
    id,
    modelsFor,
    resolve: (harness, model = "") => {
      const controls = remoteModelControls(
        catalog,
        harness as RemoteProvider,
        model,
        model === savedModel ? savedSettings : {},
        savedModel,
      );
      return {
        ...(controls.model ?? {
          id: model,
          harness,
          name: model || "Loading models…",
          nativeId: model.replace(/^[a-z]+:/, ""),
        }),
        settings: controls.settings,
      } satisfies AgentModel;
    },
    find: (model) =>
      Object.values(catalog?.models ?? {})
        .flat()
        .find((entry) => entry.id === model),
    available: (harness) => descriptor?.providers.includes(harness as RemoteProvider) ?? false,
    probed: () => !!descriptor,
    refresh,
  };
}

/** Catalog ownership follows the execution target, never the desktop context.
 * Reading a catalog does not register a project or alter the host's defaults. */
export function HostModelSource({
  machine,
  cwd,
  model,
  values,
  local = false,
  children,
}: {
  machine?: RemoteMachine;
  cwd: string;
  model: string;
  values: Record<string, string>;
  local?: boolean;
  children: ReactNode;
}) {
  const query = useQuery({
    queryKey: ["models", "host-form", machine?.id, machine?.endpoint, machine?.environmentId, cwd],
    enabled: !local && !!machine,
    queryFn: async () => {
      const [descriptor, projects] = await Promise.all([
        remoteRequest<HostDescriptor>(machine!.id, "environment.describe"),
        machineProjects(machine!),
      ]);
      const hostPath = parseRemotePath(cwd)?.hostPath ?? cwd;
      const project = projects.find((entry) => pathKey(entry.cwd) === pathKey(hostPath));
      const catalog = await remoteRequest<HostModelCatalog>(machine!.id, "models.list", {
        ...(project ? { projectId: project.id } : {}),
        progressive: true,
      });
      if (!catalog?.models || !catalog.errors) throw new Error("Invalid host model catalog");
      return { descriptor: requireHostDescriptor(descriptor), catalog };
    },
    staleTime: 30_000,
    retry: false,
    refetchInterval: (state) => (state.state.data?.catalog.pending?.length ? 1000 : false),
  });
  const source = useMemo(
    () =>
      local
        ? LOCAL_MODEL_SOURCE
        : hostModelSource(
            JSON.stringify([machine?.id, machine?.endpoint, machine?.environmentId, cwd]),
            query.data?.descriptor,
            query.data?.catalog,
            model,
            values,
            () => {
              if (machine) void query.refetch();
            },
          ),
    [local, machine, cwd, query.data, query.refetch, model, values],
  );
  return <ModelSourceContext.Provider value={source}>{children}</ModelSourceContext.Provider>;
}
