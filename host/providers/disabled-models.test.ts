import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { applyDisabledModels } from "../domains/models/disabled-models";
import { HostStore } from "../store";
import { parseDisabledModels, readDisabledModels, saveDisabledModels } from "./disabled-models";

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

it("distinguishes missing and empty settings from an invalid stored value", async () => {
  const root = await mkdtemp(join(tmpdir(), "disabled-models-"));
  const store = new HostStore(join(root, "host.db"));
  try {
    await expect(readDisabledModels(store)).resolves.toBeUndefined();
    await saveDisabledModels(store, []);
    await expect(readDisabledModels(store)).resolves.toEqual([]);
    for (const value of ["{", "{}"]) {
      await store.db
        .prepare("UPDATE host_settings SET value=? WHERE key=?")
        .run(value, "disabledModels");
      await expect(readDisabledModels(store)).rejects.toThrow(
        "Saved disabled-model settings are invalid.",
      );
    }
    await saveDisabledModels(store, ["codex:a"]);
    await expect(readDisabledModels(store)).resolves.toEqual(["codex:a"]);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
