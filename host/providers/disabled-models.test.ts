import { expect, it } from "vitest";
import { applyDisabledModels } from "../domains/models/disabled-models";
import { parseDisabledModels } from "./disabled-models";

const catalog = {
  models: {
    codex: [{ id: "codex:a" }, { id: "codex:b" }],
    claude: [{ id: "claude:claude-opus-4-7" }, { id: "claude:sonnet-4-6" }],
  },
  errors: {},
};

it("returns the catalog untouched when nothing was published or disabled", () => {
  expect(applyDisabledModels(catalog, undefined)).toBe(catalog);
  expect(applyDisabledModels(catalog, [])).toBe(catalog);
});

it("hides disabled models and matches Claude ids across dotted and CLI spellings", () => {
  const result = applyDisabledModels(catalog, ["codex:a", "claude:opus-4.7"]);
  expect(result.models.codex).toEqual([{ id: "codex:b" }]);
  expect(result.models.claude).toEqual([{ id: "claude:sonnet-4-6" }]);
  expect(result.errors).toBe(catalog.errors);
});

it("keeps a provider's full list when every model is disabled", () => {
  expect(applyDisabledModels(catalog, ["codex:a", "codex:b"]).models.codex).toHaveLength(2);
});

it("drops malformed entries when parsing", () => {
  expect(parseDisabledModels(["x", "x", 3, "", null])).toEqual(["x"]);
  expect(parseDisabledModels("x")).toEqual([]);
});
