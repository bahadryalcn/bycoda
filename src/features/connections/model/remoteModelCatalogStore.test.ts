// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  flushRemoteModelCatalogStoreForTests,
  parseHostModelCatalog,
  persistModelCatalog,
  readPersistedModelCatalog,
  REMOTE_MODEL_CATALOG_ENTRIES,
  REMOTE_MODEL_CATALOG_STORAGE_KEY,
  reloadRemoteModelCatalogStoreForTests,
  resetRemoteModelCatalogStoreForTests,
} from "./remoteModelCatalogStore";

const valid = { models: { codex: [{ id: "m", label: "M" }] }, errors: { claude: "boom" } };

beforeEach(() => resetRemoteModelCatalogStoreForTests());

describe("parseHostModelCatalog", () => {
  it("accepts a catalog with optional pending and accounts", () => {
    expect(parseHostModelCatalog(valid)).toBe(valid);
    expect(
      parseHostModelCatalog({
        ...valid,
        pending: ["codex"],
        accounts: { codex: [{ id: "a", label: "A" }] },
      }),
    ).toBeTruthy();
  });

  it.each([
    null,
    [],
    { errors: {} },
    { models: { codex: "x" }, errors: {} },
    { models: {}, errors: { codex: 1 } },
    { models: {}, errors: {}, pending: [1] },
    { models: {}, errors: {}, accounts: { codex: [{ id: 1 }] } },
  ])("rejects malformed data %#", (value) => {
    expect(() => parseHostModelCatalog(value)).toThrow();
  });
});

describe("persisted catalogs", () => {
  it("round-trips through storage after a coalesced write", () => {
    persistModelCatalog("k", valid as never);
    expect(localStorage.getItem(REMOTE_MODEL_CATALOG_STORAGE_KEY)).toBeNull();
    flushRemoteModelCatalogStoreForTests();
    expect(localStorage.getItem(REMOTE_MODEL_CATALOG_STORAGE_KEY)).toContain('"k"');
    reloadRemoteModelCatalogStoreForTests();
    expect(readPersistedModelCatalog("k")).toEqual(valid);
  });

  it("evicts the oldest scope beyond the entry budget", () => {
    for (let index = 0; index <= REMOTE_MODEL_CATALOG_ENTRIES; index++)
      persistModelCatalog(`k${index}`, valid as never);
    expect(readPersistedModelCatalog("k0")).toBeUndefined();
    expect(readPersistedModelCatalog(`k${REMOTE_MODEL_CATALOG_ENTRIES}`)).toBeTruthy();
  });

  it("ignores corrupt storage and malformed entries", () => {
    localStorage.setItem(
      REMOTE_MODEL_CATALOG_STORAGE_KEY,
      JSON.stringify({ good: valid, bad: { models: 1 } }),
    );
    reloadRemoteModelCatalogStoreForTests();
    expect(readPersistedModelCatalog("good")).toEqual(valid);
    expect(readPersistedModelCatalog("bad")).toBeUndefined();
    resetRemoteModelCatalogStoreForTests();
    localStorage.setItem(REMOTE_MODEL_CATALOG_STORAGE_KEY, "{not json");
    expect(readPersistedModelCatalog("good")).toBeUndefined();
  });
});
