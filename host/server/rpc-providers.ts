import type { GenericAcpConfig } from "../../src/features/providers/model/genericAcp";
import type { HandoffHistory } from "../../src/features/sessions/model/handoffBudget";
import { desktopOperationId, type DesktopReviewScope } from "../desktop/reviewed-desktop-scope";
import {
  listShellProfiles,
  setChosenProfile,
  setReviewedProfile,
} from "../execution/shellProfiles";
import { type GenericAcpMetadataPatch } from "../providers/generic-acp";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
import { resolveBinary } from "./support";
export async function handleProvidersRpc(
  dependencies: Pick<
    ServerBindings,
    | "providers"
    | "engine"
    | "genericAcp"
    | "catalogs"
    | "modelsService"
    | "scopedDesktopCall"
    | "desktopSigningSecret"
    | "featureMeta"
    | "handoffHistory"
  >,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "providers.center.read": {
      const entries = await Promise.all(
        [...new Set(dependencies.providers)]
          .filter((id) => id !== "acp")
          .map(async (id) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const launcher = await Promise.race([
              resolveBinary[id]().then(
                () => "resolved" as const,
                () => "unavailable" as const,
              ),
              new Promise<"unknown">((resolve) => {
                timer = setTimeout(() => resolve("unknown"), 1500);
              }),
            ]).finally(() => {
              if (timer) clearTimeout(timer);
            });
            return { id, label: id, launcher, accountState: "desktop-only" as const };
          }),
      );
      request.result = {
        environmentId: dependencies.engine.store.environmentId,
        sampledAt: Date.now(),
        providers: entries,
        acp: await dependencies.genericAcp.center(),
      };
      break;
    }
    case "providers.acp.patchMetadata":
      await dependencies.genericAcp.patchMetadata(request.params as GenericAcpMetadataPatch);
      dependencies.catalogs.clear();
      request.result = null;
      break;
    case "models.list": {
      request.result = await dependencies.modelsService.list(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;
    }
    case "providers.desktop.read":
      request.result = await dependencies.scopedDesktopCall(
        request.token,
        "providerManagement.read",
        request.params,
        [],
      );
      break;
    case "providers.desktop.patch":
    case "providers.desktop.status":
    case "providers.desktop.quota.refresh": {
      const mode = request.input.method.slice("providers.desktop.".length);
      const scope: DesktopReviewScope = {
        environmentId: dependencies.engine.store.environmentId,
        projectId: String(request.params.projectId ?? ""),
        sessionId: String(request.params.sessionId ?? ""),
        feature: "provider-management",
      };
      const operationId = desktopOperationId(
        await dependencies.desktopSigningSecret(),
        request.token,
        scope,
        request.params.operationId,
      );
      request.result = await dependencies.scopedDesktopCall(
        request.token,
        `providerManagement.${mode === "quota.refresh" ? "quotaRefresh" : mode}`,
        { ...request.params, operationId },
        mode === "patch"
          ? ["operationId", "expectedAccountRevision", "provider", "accountId", "change"]
          : mode === "quota.refresh"
            ? ["operationId", "expectedAccountRevision", "provider", "accountId", "confirm"]
            : ["operationId"],
      );
      if (
        !request.result ||
        typeof request.result !== "object" ||
        Array.isArray(request.result) ||
        (request.result as Record<string, unknown>).operationId !== operationId
      )
        throw new Error("Invalid provider operation response");
      request.result = {
        ...(request.result as Record<string, unknown>),
        operationId: request.params.operationId,
      };
      break;
    }
    case "shell.profiles":
      request.result = listShellProfiles();
      break;
    case "shell.setProfile":
      setChosenProfile(
        typeof request.params.profile === "string" && request.params.profile.trim()
          ? request.params.profile.trim()
          : null,
      );
      request.result = listShellProfiles();
      break;
    case "shell.setProfileReviewed":
      request.result = setReviewedProfile(request.params);
      break;
    case "generic_acp_cancel_install":
      dependencies.genericAcp.cancelInstall(String(request.params.id ?? ""));
      request.result = null;
      break;
    case "generic_acp_install":
      await dependencies.genericAcp.install(
        String(request.params.id ?? ""),
        String(request.params.version ?? ""),
      );
      dependencies.catalogs.clear();
      request.result = null;
      break;
    case "generic_acp_list":
      request.result = await dependencies.genericAcp.list();
      break;
    case "generic_acp_registry":
      request.result = await dependencies.genericAcp.registry(request.params.refresh === true);
      break;
    case "generic_acp_remove":
      await dependencies.genericAcp.remove(String(request.params.id ?? ""));
      dependencies.catalogs.clear();
      request.result = null;
      break;
    case "generic_acp_save":
      await dependencies.genericAcp.save(request.params.config as GenericAcpConfig);
      dependencies.catalogs.clear();
      request.result = null;
      break;
    case "handoff_history_save":
    case "handoff_history_read": {
      const projectId = String(request.params.projectId ?? "");
      await dependencies.engine.store.project(projectId);
      const sessionId =
        request.input.method === "handoff_history_save"
          ? (request.params.history as HandoffHistory)?.sessionId
          : String(request.params.sessionId ?? "");
      if (!sessionId) throw new Error("Invalid conversation");
      if ((await dependencies.featureMeta(sessionId)).projectId !== projectId)
        throw new Error("Conversation belongs to another project");
      request.result =
        request.input.method === "handoff_history_save"
          ? await dependencies.handoffHistory.save(request.params.history as HandoffHistory)
          : await dependencies.handoffHistory.read(
              sessionId,
              Number(request.params.cursor ?? 0),
              Number(request.params.limit ?? 20),
            );
      break;
    }
  }
}
