import type { ModelSource } from "../../sessions/public/modelSource";
import type { AgentModel } from "../../sessions/public/models";
import type { HarnessId, Session } from "../../sessions";
import { DEFAULT_PROVIDER_ACCOUNT_ID } from "../../providers/public/providerAccounts";
import type { HostDescriptor, RemoteProvider } from "./protocol";
import { remoteModelControls } from "./remoteModels";
import type { useRemoteModelCatalog } from "./useRemoteModelCatalog";

export type RemoteModelSourceInput = {
  catalog: ReturnType<typeof useRemoteModelCatalog>["catalog"];
  environmentId: string;
  hostSession: Session | undefined;
  descriptor: HostDescriptor | undefined;
  providers: RemoteProvider[];
  refreshCatalog: ModelSource["refresh"];
};

/** The model picker's view of one remote conversation: the host catalog, with the saved model kept visible. */
export function buildRemoteModelSource({
  catalog,
  environmentId,
  hostSession,
  descriptor,
  providers,
  refreshCatalog,
}: RemoteModelSourceInput): ModelSource {
  const models = (harness: HarnessId) => catalog?.models[harness as RemoteProvider] ?? [];
  const savedModel = hostSession?.model;
  const savedSettings = hostSession?.modelSettings ?? {};
  // A Host can use its CLI profile without listing it alongside named accounts.
  const accounts = Object.fromEntries(
    Object.entries(catalog?.accounts ?? {}).map(([provider, profiles]) => {
      const named = profiles.filter((profile) => profile.id !== DEFAULT_PROVIDER_ACCOUNT_ID);
      return [provider, named.length ? named : profiles];
    }),
  );
  return {
    id: `remote:${environmentId}`,
    // Only the Host's own lists; a provider it has not reported yet stays absent (unknown).
    accounts,
    accountsKnown: (harness) => !!catalog?.accounts?.[harness as "claude" | "codex" | "grok"],
    modelsFor: models,
    resolve: (harness, id = "") => {
      const provider = harness as RemoteProvider;
      // Keep the saved model's effort visible even when the host catalog is
      // loading, failed, or no longer lists it.
      const controls = remoteModelControls(
        catalog,
        provider,
        id,
        id === savedModel ? savedSettings : {},
        savedModel,
      );
      const listed = controls.model;
      return {
        ...(listed ?? {
          id,
          harness,
          name: id ? id.replace(/^[a-z]+:/, "") : "Loading models…",
          nativeId: id.replace(/^[a-z]+:/, ""),
        }),
        settings: controls.settings,
      } satisfies AgentModel;
    },
    find: (id) => providers.flatMap((harness) => models(harness)).find((m) => m.id === id),
    available: (harness) =>
      providers.includes(harness as RemoteProvider) &&
      (!hostSession ||
        descriptor?.capabilities.includes("sessions.harnessSwitch") === true ||
        hostSession.harness === harness),
    probed: () => !!descriptor,
    // The host re-probes when a provider CLI changes or its catalog ages,
    // so each picker opening asks again.
    refresh: refreshCatalog,
  };
}
