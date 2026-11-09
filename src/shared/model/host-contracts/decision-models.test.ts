import { describe, expect, it } from "vitest";
import {
  DECISION_INSTALL_CONFIRMATION,
  DECISION_MODELS_RPC,
  DecisionLocalInstallParamsSchema,
  type DecisionModelsMethod,
} from "./decision-models";

describe("decision model local install contract", () => {
  it("names the confirmation the Host requires before a model download starts", () => {
    expect(DECISION_INSTALL_CONFIRMATION).toBe("INSTALL_DECISION_MODEL");
  });

  it("accepts an install only with the exact confirmation literal", () => {
    expect(
      DecisionLocalInstallParamsSchema.safeParse({
        modelId: "clef-flash-9b",
        confirm: "INSTALL_DECISION_MODEL",
      }).success,
    ).toBe(true);
    for (const confirm of ["install", "INSTALL_DECISION_MODEL ", "", undefined]) {
      expect(
        DecisionLocalInstallParamsSchema.safeParse({ modelId: "clef-flash-9b", confirm }).success,
        String(confirm),
      ).toBe(false);
    }
  });

  it("refuses unknown keys so a stray flag cannot ride along with an install", () => {
    expect(
      DecisionLocalInstallParamsSchema.safeParse({
        modelId: "clef-flash-9b",
        confirm: "INSTALL_DECISION_MODEL",
        autoStart: true,
      }).success,
    ).toBe(false);
  });

  it("binds the local.install RPC to that schema", () => {
    expect(DECISION_MODELS_RPC["decisionModels.local.install"].params).toBe(
      DecisionLocalInstallParamsSchema,
    );
  });
});

describe("decision model RPC inventory", () => {
  // Every method the settings client (features/decision-models/model/decisionModelsClient.ts) calls.
  const CLIENT_METHODS: DecisionModelsMethod[] = [
    "decisionModels.sources.list",
    "decisionModels.sources.add",
    "decisionModels.sources.update",
    "decisionModels.sources.remove",
    "decisionModels.sources.test",
    "decisionModels.sources.evaluate",
    "decisionModels.discovery.scan",
    "decisionModels.discovery.results",
    "decisionModels.discovery.settings.get",
    "decisionModels.discovery.settings.set",
    "decisionModels.manual.verify",
    "decisionModels.firstRun.get",
    "decisionModels.firstRun.set",
    "decisionModels.local.hardware",
    "decisionModels.local.recommend",
    "decisionModels.local.plan",
    "decisionModels.local.install",
    "decisionModels.local.start",
    "decisionModels.local.stop",
    "decisionModels.local.uninstall",
    "decisionModels.local.status",
    "decisionModels.routing.get",
    "decisionModels.routing.set",
    "decisionModels.catalog.get",
    "decisionModels.decide",
  ];

  it("declares every method the client calls, with params and a result schema", () => {
    for (const method of CLIENT_METHODS) {
      const definition = DECISION_MODELS_RPC[method];
      expect(definition, method).toBeDefined();
      expect(definition.params, method).toBeDefined();
      expect(definition.result, method).toBeDefined();
    }
    expect(Object.keys(DECISION_MODELS_RPC).sort()).toEqual([...CLIENT_METHODS].sort());
  });
});
