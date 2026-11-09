import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultDecisionConfig, loadDecisionConfig, saveDecisionConfig } from "./decision-config";

let directory: string;
let path: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "decision-config-"));
  path = join(directory, "config.json");
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("decision config state file", () => {
  it("returns the default config when no file exists", async () => {
    const loaded = await loadDecisionConfig(path);
    expect(loaded).toEqual({ config: defaultDecisionConfig(), damaged: false });
    expect(loaded.config.routing).toEqual({});
    expect(loaded.config.localOnlyPersonalData).toBe(false);
    expect(loaded.config.firstRunDismissed).toBe(false);
  });

  it("round-trips a saved config with a source and a route", async () => {
    const config = defaultDecisionConfig();
    config.sources.push({
      id: "src-1",
      name: "Local Clef",
      kind: "local",
      adapter: "systemone",
      endpoint: "http://127.0.0.1:8080/v1/systemone",
      secretRef: "decision-models.src-1",
      status: "ready",
    });
    config.routing.screen_state = { sourceIds: ["src-1"], threshold: 0.85 };

    await saveDecisionConfig(path, config);
    const loaded = await loadDecisionConfig(path);

    expect(loaded.damaged).toBe(false);
    expect(loaded.config).toEqual(config);
    expect(readFileSync(path, "utf8").endsWith("\n")).toBe(true);
  });

  it("marks invalid JSON as damaged and leaves the original bytes in place", async () => {
    writeFileSync(path, "{not json");

    const loaded = await loadDecisionConfig(path);

    expect(loaded.damaged).toBe(true);
    expect(loaded.config).toEqual(defaultDecisionConfig());
    expect(readFileSync(path, "utf8")).toBe("{not json");
  });

  it("treats unknown fields as damaged so a newer file is never overwritten", async () => {
    writeFileSync(path, JSON.stringify({ ...defaultDecisionConfig(), futureField: true }));

    const loaded = await loadDecisionConfig(path);

    expect(loaded.damaged).toBe(true);
    expect(readFileSync(path, "utf8")).toContain("futureField");
  });

  it("rejects a config whose route has a threshold above 1", async () => {
    const config = defaultDecisionConfig();
    config.routing.generic = { sourceIds: [], threshold: 1.5 };
    writeFileSync(path, JSON.stringify(config));

    expect((await loadDecisionConfig(path)).damaged).toBe(true);
  });
});
