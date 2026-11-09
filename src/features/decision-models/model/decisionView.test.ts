import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROUTE_THRESHOLD,
  candidateSourceInput,
  clampName,
  cleanRouting,
  endpointError,
  endpointSourceKind,
  localOffer,
  setRouteSources,
  setRouteThreshold,
} from "./decisionView";

describe("endpointError", () => {
  it("accepts http and https addresses", () => {
    expect(endpointError("http://127.0.0.1:8769/v1/systemone")).toBeNull();
    expect(endpointError("https://api.example.com/v1")).toBeNull();
  });

  it("rejects empty, relative and non-http addresses", () => {
    expect(endpointError("")).not.toBeNull();
    expect(endpointError("127.0.0.1:8080")).not.toBeNull();
    expect(endpointError("ftp://example.com")).not.toBeNull();
  });
});

describe("endpointSourceKind", () => {
  it("treats loopback addresses as local services", () => {
    expect(endpointSourceKind("http://127.0.0.1:8080/v1/systemone")).toBe("local");
    expect(endpointSourceKind("http://localhost:11434/api/systemone")).toBe("local");
  });

  it("treats other addresses and unreadable input as API", () => {
    expect(endpointSourceKind("https://openrouter.ai/api/v1/systemone")).toBe("api");
    expect(endpointSourceKind("not a url")).toBe("api");
  });
});

describe("localOffer", () => {
  it("offers install only for a usable tier with a catalog model", () => {
    expect(localOffer({ tier: "strong", modelId: "clef-flash-9b" })).toBe("install");
    expect(localOffer({ tier: "strong" })).toBe("unknown");
  });

  it("sends an insufficient machine to the API path, never to install", () => {
    expect(localOffer({ tier: "insufficient", modelId: "clef-flash-9b" })).toBe("api");
  });

  it("stays unknown until the recommendation has loaded", () => {
    expect(localOffer(undefined)).toBe("unknown");
    expect(localOffer(null)).toBe("unknown");
  });
});

describe("routing helpers", () => {
  it("keeps the given order, drops duplicates and uses the default threshold", () => {
    expect(setRouteSources(undefined, ["b", "a", "b"])).toEqual({
      sourceIds: ["b", "a"],
      threshold: DEFAULT_ROUTE_THRESHOLD,
    });
  });

  it("keeps the source list when only the threshold changes", () => {
    expect(setRouteThreshold({ sourceIds: ["a"], threshold: 0.85 }, 0.9)).toEqual({
      sourceIds: ["a"],
      threshold: 0.9,
    });
  });

  it("drops tasks without sources before saving", () => {
    expect(
      cleanRouting({
        screen_state: { sourceIds: ["a"], threshold: 0.85 },
        optout: { sourceIds: [], threshold: 0.85 },
      }),
    ).toEqual({ screen_state: { sourceIds: ["a"], threshold: 0.85 } });
  });
});

describe("candidateSourceInput", () => {
  it("maps a model file with its path to a local source", () => {
    expect(
      candidateSourceInput({
        id: "c1",
        label: "clef-flash.gguf",
        kind: "model_file",
        detail: "C:\\Models\\clef-flash.gguf",
      }),
    ).toEqual({
      name: "clef-flash.gguf",
      kind: "local",
      adapter: "systemone",
      local: { modelPath: "C:\\Models\\clef-flash.gguf" },
    });
  });

  it("returns null for other kinds and for a model file without a path", () => {
    expect(
      candidateSourceInput({ id: "c2", label: "llama-server", kind: "runtime_process" }),
    ).toBeNull();
    expect(candidateSourceInput({ id: "c3", label: "model", kind: "model_file" })).toBeNull();
  });
});

describe("clampName", () => {
  it("trims and limits a name to the wire length", () => {
    expect(clampName("  Local  ")).toBe("Local");
    expect(clampName("a".repeat(150))).toHaveLength(100);
  });
});
