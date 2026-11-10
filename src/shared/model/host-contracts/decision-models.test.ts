import { describe, expect, it } from "vitest";
import { HOST_RPC_METHODS } from "./methods";
import {
  DECISION_INSTALL_CONFIRMATION,
  DECISION_MODELS_RPC,
  DecisionLocalInstallParamsSchema,
  DecisionManualVerifyResultSchema,
  DecisionManualVerifyParamsSchema,
  DiscoveryResultSchema,
  type DecisionModelsMethod,
} from "./decision-models";

describe("decision model local install contract", () => {
  it("lets folder verification finish its bounded scan before the RPC response expires", () => {
    expect(HOST_RPC_METHODS["decisionModels.manual.verify"].responseTimeoutMs).toBeGreaterThan(
      30_000,
    );
  });
  it("allows a cold local start and its first test to settle before the response expires", () => {
    expect(HOST_RPC_METHODS["decisionModels.sources.test"].responseTimeoutMs).toBeGreaterThan(
      90_000,
    );
    expect(HOST_RPC_METHODS["decisionModels.local.start"].responseTimeoutMs).toBeGreaterThan(
      90_000,
    );
  });
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
  it("accepts a discovered file as model_installation while retaining the folder result contract", () => {
    expect(
      DecisionManualVerifyParamsSchema.parse({
        kind: "model_installation",
        path: "G:/clef/models/clef.gguf",
      }),
    ).toEqual({
      kind: "model_installation",
      path: "G:/clef/models/clef.gguf",
    });
    expect(
      DecisionManualVerifyParamsSchema.safeParse({
        kind: "model_installation",
        path: "",
        run: true,
      }).success,
    ).toBe(false);
    expect(
      DecisionManualVerifyResultSchema.safeParse({
        kind: "installation_folder",
        folder: "G:/clef",
        modelPath: "G:/clef/models/clef.gguf",
        verified: false,
      }).success,
    ).toBe(true);
  });
  it("accepts bounded folder choices and incomplete scan results", () => {
    expect(
      DecisionManualVerifyResultSchema.parse({
        kind: "installation_folder",
        folder: "C:/models",
        modelPath: "C:/models/m.gguf",
        verified: false,
        models: [
          {
            name: "Model",
            modelPath: "C:/models/m.gguf",
            projectorPath: "C:/models/mmproj.gguf",
            verified: false,
          },
        ],
        incomplete: true,
      }),
    ).toMatchObject({ incomplete: true });
    expect(DiscoveryResultSchema.parse({ found: [], incomplete: true })).toEqual({
      found: [],
      incomplete: true,
    });
    expect(DiscoveryResultSchema.parse({ found: [] })).toEqual({ found: [] });
  });
  // Every method the settings client (features/decision-models/model/decisionModelsClient.ts) calls.
  const CLIENT_METHODS: DecisionModelsMethod[] = [
    "decisionModels.sources.list",
    "decisionModels.sources.add",
    "decisionModels.sources.update",
    "decisionModels.sources.remove",
    "decisionModels.sources.test",
    "decisionModels.sources.evaluate",
    "decisionModels.discovery.scan",
    "decisionModels.discovery.cancel",
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
