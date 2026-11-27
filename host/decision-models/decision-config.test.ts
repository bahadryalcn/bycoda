import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DecisionConfigDamagedError,
  defaultDecisionConfig,
  loadDecisionConfig,
  requireDecisionConfig,
  saveDecisionConfig,
} from "./decision-config";

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

describe("decision config damage diagnostics", () => {
  const SECRET = "sk-live-0123456789-never-in-diagnostics";

  async function damageOf(text: string) {
    writeFileSync(path, text);
    const loaded = await loadDecisionConfig(path);
    if (!loaded.damaged) throw new Error("expected a damaged config");
    return loaded.damage;
  }

  it("classifies the failure and keeps file text out of the diagnostics", async () => {
    expect(await damageOf(`{"apiKey": "${SECRET}"`)).toEqual({
      reason: "invalid_json",
      evidenceKept: true,
    });
    expect(await damageOf("   ")).toEqual({ reason: "empty", evidenceKept: true });
  });

  it("names the first invalid field by schema path without values or unknown keys", async () => {
    const config = defaultDecisionConfig();
    config.sources.push({
      id: "src-1",
      name: "Clef",
      kind: "local",
      adapter: "systemone",
      endpoint: SECRET.repeat(200),
      status: "ready",
    });
    const damage = await damageOf(JSON.stringify(config));
    expect(damage.reason).toBe("invalid_shape");
    expect(damage.field).toBe("sources.0.endpoint");

    const unknownKey = await damageOf(
      JSON.stringify({ ...defaultDecisionConfig(), [SECRET]: true }),
    );
    expect(unknownKey).toEqual({ reason: "invalid_shape", evidenceKept: true });
  });

  it("builds a bounded error message that never contains file content", async () => {
    const damage = await damageOf(`{"routing": {"${SECRET}": 1}}`);
    const error = new DecisionConfigDamagedError(damage);

    expect(error.code).toBe("config_damaged");
    expect(error.message).toContain("Decision model settings are damaged");
    expect(error.message).not.toContain(SECRET);
    expect(error.message.length).toBeLessThan(200);
  });

  it("requireDecisionConfig throws for a damaged file and returns defaults for a missing one", async () => {
    await expect(requireDecisionConfig(path)).resolves.toEqual(defaultDecisionConfig());

    writeFileSync(path, "{broken");
    await expect(requireDecisionConfig(path)).rejects.toBeInstanceOf(DecisionConfigDamagedError);
  });
});
