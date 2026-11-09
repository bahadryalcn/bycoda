import { describe, expect, it } from "vitest";
import { loadCatalog } from "./catalog";

describe("loadCatalog", () => {
  const catalog = loadCatalog();

  it("parses the bundled version-1 catalog", () => {
    expect(catalog.version).toBe(1);
    expect(catalog.updatedAt).toBe("2026-11-07");
    expect(catalog.providers.length).toBeGreaterThan(0);
  });

  it("has unique provider ids", () => {
    const ids = catalog.providers.map((provider) => provider.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("leaves unverified providers without endpoint, limits or price", () => {
    for (const provider of catalog.providers.filter((entry) => !entry.verified)) {
      expect(provider.defaultEndpoint, provider.id).toBeUndefined();
      expect(provider.limits, provider.id).toBeUndefined();
      expect(provider.price, provider.id).toBeUndefined();
    }
  });

  it("keeps unverified model and local file entries explicitly marked", () => {
    for (const provider of catalog.providers) {
      for (const model of provider.models) {
        expect(typeof model.verified, `${provider.id}/${model.id}`).toBe("boolean");
        for (const file of model.localFiles ?? []) {
          expect(typeof file.verified, `${provider.id}/${file.fileName}`).toBe("boolean");
          if (file.sha256 !== undefined) expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
        }
      }
    }
  });

  it("records the verified Clef local contract with a loopback endpoint", () => {
    const clef = catalog.providers.find((entry) => entry.id === "clef-local");
    expect(clef?.verified).toBe(true);
    expect(clef?.adapter).toBe("systemone");
    expect(clef?.defaultEndpoint).toBe("http://127.0.0.1:8767/v1/systemone");
    expect(clef?.models[0]?.verified).toBe(false);
  });

  it("uses only known adapters", () => {
    const known = new Set([
      "systemone",
      "decisions",
      "ollama-systemone",
      "llm-structured",
      "custom",
    ]);
    for (const provider of catalog.providers) {
      if (provider.adapter !== undefined)
        expect(known.has(provider.adapter), provider.id).toBe(true);
    }
  });
});
