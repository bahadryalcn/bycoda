import type { z } from "zod";
import {
  DECISION_MODELS_RPC,
  type DecisionModelsMethod,
} from "../../../shared/model/host-contracts/decision-models";
import { remoteRequest } from "../../connections/public/connections";

/** Params and result of one decision-model RPC method, straight from the shared Host contract. */
export type DecisionParams<M extends DecisionModelsMethod> = z.input<
  (typeof DECISION_MODELS_RPC)[M]["params"]
>;
export type DecisionResponse<M extends DecisionModelsMethod> = z.output<
  (typeof DECISION_MODELS_RPC)[M]["result"]
>;

export type DecisionRequest = DecisionParams<"decisionModels.decide">;
export type DecisionResult = DecisionResponse<"decisionModels.decide">;

/**
 * Typed wrappers for the `decisionModels.*` RPC methods (target-architecture section 7).
 * Method names and schemas come from the shared contract; this file adds no shapes of its own.
 */
export function decisionModelsClient(machineId: string) {
  const call = <M extends DecisionModelsMethod>(method: M, params: DecisionParams<M>) =>
    remoteRequest<DecisionResponse<M>>(machineId, method, params);
  return {
    sources: {
      list: (params: DecisionParams<"decisionModels.sources.list">) =>
        call("decisionModels.sources.list", params),
      add: (params: DecisionParams<"decisionModels.sources.add">) =>
        call("decisionModels.sources.add", params),
      update: (params: DecisionParams<"decisionModels.sources.update">) =>
        call("decisionModels.sources.update", params),
      remove: (params: DecisionParams<"decisionModels.sources.remove">) =>
        call("decisionModels.sources.remove", params),
      test: (params: DecisionParams<"decisionModels.sources.test">) =>
        call("decisionModels.sources.test", params),
      evaluate: (params: DecisionParams<"decisionModels.sources.evaluate">) =>
        call("decisionModels.sources.evaluate", params),
    },
    discovery: {
      cancel: (params: DecisionParams<"decisionModels.discovery.cancel">) =>
        call("decisionModels.discovery.cancel", params),
      scan: (params: DecisionParams<"decisionModels.discovery.scan">) =>
        call("decisionModels.discovery.scan", params),
      results: (params: DecisionParams<"decisionModels.discovery.results">) =>
        call("decisionModels.discovery.results", params),
      settings: {
        get: (params: DecisionParams<"decisionModels.discovery.settings.get">) =>
          call("decisionModels.discovery.settings.get", params),
        set: (params: DecisionParams<"decisionModels.discovery.settings.set">) =>
          call("decisionModels.discovery.settings.set", params),
      },
    },
    manual: {
      verify: (params: DecisionParams<"decisionModels.manual.verify">) =>
        call("decisionModels.manual.verify", params),
    },
    firstRun: {
      get: (params: DecisionParams<"decisionModels.firstRun.get">) =>
        call("decisionModels.firstRun.get", params),
      set: (params: DecisionParams<"decisionModels.firstRun.set">) =>
        call("decisionModels.firstRun.set", params),
    },
    local: {
      hardware: (params: DecisionParams<"decisionModels.local.hardware">) =>
        call("decisionModels.local.hardware", params),
      recommend: (params: DecisionParams<"decisionModels.local.recommend">) =>
        call("decisionModels.local.recommend", params),
      plan: (params: DecisionParams<"decisionModels.local.plan">) =>
        call("decisionModels.local.plan", params),
      install: (params: DecisionParams<"decisionModels.local.install">) =>
        call("decisionModels.local.install", params),
      start: (params: DecisionParams<"decisionModels.local.start">) =>
        call("decisionModels.local.start", params),
      stop: (params: DecisionParams<"decisionModels.local.stop">) =>
        call("decisionModels.local.stop", params),
      uninstall: (params: DecisionParams<"decisionModels.local.uninstall">) =>
        call("decisionModels.local.uninstall", params),
      status: (params: DecisionParams<"decisionModels.local.status">) =>
        call("decisionModels.local.status", params),
    },
    routing: {
      get: (params: DecisionParams<"decisionModels.routing.get">) =>
        call("decisionModels.routing.get", params),
      set: (params: DecisionParams<"decisionModels.routing.set">) =>
        call("decisionModels.routing.set", params),
    },
    catalog: {
      get: (params: DecisionParams<"decisionModels.catalog.get">) =>
        call("decisionModels.catalog.get", params),
    },
    decide: (params: DecisionRequest) => call("decisionModels.decide", params),
  };
}
export type DecisionModelsClient = ReturnType<typeof decisionModelsClient>;
