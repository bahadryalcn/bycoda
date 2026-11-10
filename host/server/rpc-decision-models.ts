import {
  DecisionDiscoverySettingsPatchSchema,
  DecisionFirstRunSchema,
  DecisionLocalInstallParamsSchema,
  DecisionManualVerifyParamsSchema,
  DecisionModelIdParamsSchema,
  DecisionRequestSchema,
  DecisionRoutingSetParamsSchema,
  DecisionSourceIdParamsSchema,
  DecisionSourcesAddParamsSchema,
  DecisionSourcesUpdateParamsSchema,
} from "../../src/shared/model/host-contracts/decision-models";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";

const LOCAL_ADDRESSES = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

/** Keys stay on this computer: no browser origin and no remote address may send them. */
function assertLocalKeyCaller(request: OwnerRpcRequest): void {
  if (
    request.request.headers.origin ||
    !LOCAL_ADDRESSES.includes(request.request.socket.remoteAddress ?? "")
  )
    throw new Error("Decision model keys are available only on this computer.");
}

export async function handleDecisionModelsRpc(
  dependencies: Pick<ServerBindings, "decisionModels">,
  request: OwnerRpcRequest,
): Promise<void> {
  const service = dependencies.decisionModels;
  switch (request.input.method) {
    case "decisionModels.sources.list":
      request.result = { sources: await service.listSources() };
      break;

    case "decisionModels.sources.add": {
      const params = DecisionSourcesAddParamsSchema.parse(request.params);
      if (params.apiKey !== undefined) assertLocalKeyCaller(request);
      request.result = await service.addSource(params.source, params.apiKey);
      break;
    }

    case "decisionModels.sources.update": {
      const params = DecisionSourcesUpdateParamsSchema.parse(request.params);
      if (params.apiKey !== undefined) assertLocalKeyCaller(request);
      request.result = await service.updateSource(params.id, params.patch, params.apiKey);
      break;
    }

    case "decisionModels.sources.remove":
      request.result = await service.removeSource(
        DecisionSourceIdParamsSchema.parse(request.params).id,
      );
      break;

    case "decisionModels.sources.test":
      request.result = await service.testSource(
        DecisionSourceIdParamsSchema.parse(request.params).id,
      );
      break;

    case "decisionModels.sources.evaluate":
      request.result = await service.evaluateSource(
        DecisionSourceIdParamsSchema.parse(request.params).id,
      );
      break;

    case "decisionModels.discovery.scan":
      request.result = await service.scanDiscovery();
      break;

    case "decisionModels.discovery.cancel":
      request.result = service.cancelDiscovery();
      break;

    case "decisionModels.discovery.results":
      request.result = service.discoveryResults();
      break;

    case "decisionModels.discovery.settings.get":
      request.result = await service.discoverySettings();
      break;

    case "decisionModels.discovery.settings.set":
      request.result = await service.updateDiscoverySettings(
        DecisionDiscoverySettingsPatchSchema.parse(request.params),
      );
      break;

    case "decisionModels.manual.verify":
      request.result = await service.verifyManual(
        DecisionManualVerifyParamsSchema.parse(request.params),
      );
      break;

    case "decisionModels.firstRun.get":
      request.result = await service.getFirstRun();
      break;

    case "decisionModels.firstRun.set":
      request.result = await service.setFirstRun(
        DecisionFirstRunSchema.parse(request.params).dismissed,
      );
      break;

    case "decisionModels.local.hardware":
      request.result = await service.hardware();
      break;

    case "decisionModels.local.recommend":
      request.result = await service.recommendLocal();
      break;

    case "decisionModels.local.plan":
      request.result = await service.localPlan(
        DecisionModelIdParamsSchema.parse(request.params).modelId,
      );
      break;

    case "decisionModels.local.install":
      request.result = await service.installLocal(
        DecisionLocalInstallParamsSchema.parse(request.params),
      );
      break;

    case "decisionModels.local.start":
      request.result = await service.startLocal(
        DecisionSourceIdParamsSchema.parse(request.params).id,
      );
      break;

    case "decisionModels.local.stop":
      request.result = await service.stopLocal(
        DecisionSourceIdParamsSchema.parse(request.params).id,
      );
      break;

    case "decisionModels.local.uninstall":
      request.result = await service.uninstallLocal(
        DecisionSourceIdParamsSchema.parse(request.params).id,
      );
      break;

    case "decisionModels.local.status":
      request.result = await service.localStatus(
        DecisionSourceIdParamsSchema.parse(request.params).id,
      );
      break;

    case "decisionModels.routing.get":
      request.result = await service.getRouting();
      break;

    case "decisionModels.routing.set":
      request.result = await service.setRouting(
        DecisionRoutingSetParamsSchema.parse(request.params),
      );
      break;

    case "decisionModels.catalog.get":
      request.result = service.catalog();
      break;

    case "decisionModels.decide":
      request.result = await service.decide(DecisionRequestSchema.parse(request.params));
      break;

    default:
      throw new Error("Unsupported decision model method.");
  }
}
