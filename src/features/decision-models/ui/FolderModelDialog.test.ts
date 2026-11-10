// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecisionModelsClient, DecisionResponse } from "../model/decisionModelsClient";
import type { DecisionSourceInput } from "../model/decisionTypes";
import { FolderModelDialog } from "./FolderModelDialog";
import { pickPath } from "./pickPath";
import {
  bodyText,
  clickButton,
  mountDecisionUi,
  setInputValue,
  settleDecisionUi,
  unmountDecisionUi,
} from "./decisionTestDom";

vi.mock("./pickPath", () => ({ pickPath: vi.fn(async () => "G:\\Models\\Clef") }));

type FolderResult = Extract<
  DecisionResponse<"decisionModels.manual.verify">,
  { kind: "installation_folder" }
>;
const folder: FolderResult = {
  kind: "installation_folder" as const,
  folder: "G:\\Models\\Clef",
  modelPath: "G:\\Models\\Clef\\models\\clef.gguf",
  runtimePath: "G:\\Models\\Clef\\runtime\\llama-server.exe",
  model: "clef-flash",
  verified: false,
  models: [
    {
      name: "Clef Flash",
      model: "clef-flash",
      modelPath: "G:\\Models\\Clef\\models\\clef.gguf",
      runtimePath: "G:\\Models\\Clef\\runtime\\llama-server.exe",
      verified: false,
    },
  ],
};
let mounted: ReturnType<typeof mountDecisionUi> | null = null;
afterEach(() => {
  unmountDecisionUi(mounted);
  mounted = null;
  vi.clearAllMocks();
});

function render(verify = vi.fn(async () => folder), ok = true, modelPath?: string) {
  const onAdd = vi.fn(async (input: DecisionSourceInput) => ({
    ...input,
    id: "new",
    status: "unknown" as const,
  }));
  const onTest = vi.fn(async () => ({
    sourceId: "new",
    ok,
    ...(!ok ? { error: "unavailable" as const } : {}),
  }));
  mounted = mountDecisionUi(
    createElement(FolderModelDialog, {
      client: { manual: { verify } } as unknown as DecisionModelsClient,
      onAdd,
      onTest,
      onClose: vi.fn(),
      modelPath,
    }),
  );
  return { verify, onAdd, onTest };
}

describe("FolderModelDialog", () => {
  it("inspects a discovered file and preserves the Host-selected model instead of the first model", async () => {
    const vision = {
      name: "Clef Vision",
      modelPath: "G:\\Models\\Clef\\models\\vision.gguf",
      runtimePath: "G:\\Models\\Clef\\runtime-vision\\llama-server.exe",
      projectorPath: "G:\\Models\\Clef\\models\\mmproj.gguf",
      verified: false,
    };
    const checked = { ...folder, ...vision, models: [...folder.models!, vision] };
    const { verify, onAdd, onTest } = render(
      vi.fn(async () => checked),
      true,
      vision.modelPath,
    );
    await settleDecisionUi();
    expect(verify).toHaveBeenCalledWith({ kind: "model_installation", path: vision.modelPath });
    expect(document.querySelector<HTMLInputElement>("input")?.value).toBe(folder.folder);
    expect(onAdd).not.toHaveBeenCalled();
    clickButton("Test and add");
    await settleDecisionUi();
    expect(onAdd).toHaveBeenCalledWith({
      name: vision.name,
      kind: "local",
      adapter: "systemone",
      local: {
        modelPath: vision.modelPath,
        runtimePath: vision.runtimePath,
        projectorPath: vision.projectorPath,
      },
    });
    expect(onTest).toHaveBeenCalledWith("new");
  });
  it("inspects a chosen folder without adding or starting a model, then explicitly adds and tests", async () => {
    const { verify, onAdd, onTest } = render();
    clickButton("Choose folder…");
    await settleDecisionUi();
    expect(pickPath).toHaveBeenCalledWith({ title: "Choose a model folder", directory: true });
    expect(verify).toHaveBeenCalledWith({ kind: "installation_folder", path: "G:\\Models\\Clef" });
    expect(bodyText()).toContain("Clef Flash");
    expect(onAdd).not.toHaveBeenCalled();
    expect(onTest).not.toHaveBeenCalled();
    clickButton("Test and add");
    await settleDecisionUi();
    expect(onAdd).toHaveBeenCalledWith({
      name: "Clef Flash",
      kind: "local",
      adapter: "systemone",
      model: "clef-flash",
      local: { modelPath: folder.modelPath, runtimePath: folder.runtimePath },
    });
    expect(onTest).toHaveBeenCalledWith("new");
    expect(bodyText()).toContain("Added. The connection works.");
  });

  it("discards an old scan after the folder path changes", async () => {
    let finish!: (value: typeof folder) => void;
    const verify = vi.fn(
      () =>
        new Promise<typeof folder>((resolve) => {
          finish = resolve;
        }),
    );
    const { onAdd } = render(verify);
    clickButton("Choose folder…");
    await settleDecisionUi();
    const input = document.querySelector<HTMLInputElement>("input")!;
    setInputValue(input, "G:\\Another");
    finish(folder);
    await settleDecisionUi();
    expect(bodyText()).not.toContain("Clef Flash");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("keeps a registered source and reports a failed test truthfully", async () => {
    const { onAdd } = render(undefined, false);
    clickButton("Choose folder…");
    await settleDecisionUi();
    clickButton("Test and add");
    await settleDecisionUi();
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(bodyText()).toContain("Added. The connection test failed");
  });

  it("adds the selected model with its own runtime and projector", async () => {
    const vision = {
      name: "Clef Vision",
      model: "clef-vision",
      modelPath: "G:\\Models\\Clef\\vision.gguf",
      runtimePath: "G:\\Models\\Clef\\vision\\llama-server.exe",
      projectorPath: "G:\\Models\\Clef\\mmproj.gguf",
      verified: true,
    };
    const { onAdd } = render(
      vi.fn(async () => ({ ...folder, models: [...folder.models!, vision] })),
    );
    clickButton("Choose folder…");
    await settleDecisionUi();
    clickButton("Clef Flash");
    await settleDecisionUi();
    clickButton("Clef Vision");
    await settleDecisionUi();
    clickButton("Test and add");
    await settleDecisionUi();
    expect(onAdd).toHaveBeenCalledWith({
      name: vision.name,
      kind: "local",
      adapter: "systemone",
      model: vision.model,
      local: {
        modelPath: vision.modelPath,
        runtimePath: vision.runtimePath,
        projectorPath: vision.projectorPath,
      },
    });
  });

  it("keeps adding unavailable until a missing runtime is supplied", async () => {
    const { onAdd } = render(
      vi.fn(async () => ({
        ...folder,
        runtimePath: undefined,
        models: [{ name: "Clef Flash", modelPath: folder.modelPath, verified: false }],
      })),
    );
    clickButton("Choose folder…");
    await settleDecisionUi();
    expect(bodyText()).toContain("Model found, but no runtime was found.");
    clickButton("Test and add");
    expect(onAdd).not.toHaveBeenCalled();
    const runtime = Array.from(document.querySelectorAll<HTMLInputElement>("input")).find(
      (input) =>
        input.getAttribute("aria-label") === "Runtime program" ||
        (input.id &&
          document.querySelector(`label[for="${input.id}"]`)?.textContent === "Runtime program"),
    );
    if (!runtime) throw new Error("Runtime program field missing");
    setInputValue(runtime, folder.runtimePath!);
    clickButton("Test and add");
    await settleDecisionUi();
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
