import { describe, expect, it } from "vitest";
import {
  crossDelegationSummary,
  delegationNextValue,
  delegationOptionSelected,
  imageModelsSetting,
  isDelegationSetting,
  isMultiSetting,
} from "./crossDelegation";
import {
  IMAGE_MODELS_KEY,
  decodeImageModels,
  encodeImageModels,
  imageModelAllowed,
} from "../../../shared/model/host-contracts/image-models";
import { providerModelSettings } from "../../../shared/model/host-contracts/delegation";

describe("image models setting", () => {
  const setting = imageModelsSetting({ harnesses: ["codex", "antigravity", "claude"] });

  it("offers Automatic plus the connected image model providers", () => {
    expect(setting.options.map((option) => option.value)).toEqual(["", "codex", "antigravity"]);
    expect(imageModelsSetting({ harnesses: ["claude"] }).options).toHaveLength(1);
    expect(isMultiSetting(setting) && isDelegationSetting(setting)).toBe(true);
  });

  it("toggles models in place and returns to Automatic when none is left", () => {
    const one = delegationNextValue(setting, {}, "antigravity");
    expect(decodeImageModels(one)).toEqual(["antigravity"]);
    const both = delegationNextValue(setting, { [IMAGE_MODELS_KEY]: one }, "codex");
    expect(decodeImageModels(both)).toEqual(["codex", "antigravity"]);
    const values = { [IMAGE_MODELS_KEY]: both };
    expect(delegationOptionSelected(setting, values, "codex")).toBe(true);
    expect(delegationOptionSelected(setting, values, "")).toBe(false);
    expect(crossDelegationSummary(setting, values)).toBe("Codex ImageGen +1");
    expect(delegationNextValue(setting, values, "")).toBe("");
    expect(delegationNextValue(setting, { [IMAGE_MODELS_KEY]: one }, "antigravity")).toBe("");
    expect(crossDelegationSummary(setting, {})).toBe("Automatic");
  });

  it("decodes defensively, enforces the selection and never reaches providers", () => {
    expect(decodeImageModels(undefined)).toBeUndefined();
    expect(decodeImageModels("not json")).toBeUndefined();
    expect(decodeImageModels('["codex","nope",1]')).toEqual(["codex"]);
    expect(encodeImageModels([])).toBe("[]");
    expect(imageModelAllowed({}, "gemini")).toBe(true);
    expect(imageModelAllowed({ [IMAGE_MODELS_KEY]: '["codex"]' }, "gemini")).toBe(false);
    expect(imageModelAllowed({ [IMAGE_MODELS_KEY]: "[]" }, "codex")).toBe(false);
    expect(providerModelSettings({ effort: "high", [IMAGE_MODELS_KEY]: '["codex"]' })).toEqual({
      effort: "high",
    });
  });
});
