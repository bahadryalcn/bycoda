import { expect, it } from "vitest";
import { dictationModel } from "./dictationModels";

it("preserves a dynamic OpenRouter choice instead of replacing it with a static default", () => {
  expect(dictationModel("openrouter", "vendor/new-model")).toBe("vendor/new-model");
  expect(dictationModel("openai", "vendor/new-model")).toBe("gpt-4o-mini-transcribe");
});
