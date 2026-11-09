import { describe, expect, it, vi } from "vitest";

// The Host registers no harness adapter at startup; like the real registry, the mock knows a
// provider only after registerBuiltinHarnesses() ran.
const registry = vi.hoisted(() => ({ registered: false }));
vi.mock("../../src/integrations/harness/core/register", () => ({
  registerBuiltinHarnesses: vi.fn(() => {
    registry.registered = true;
  }),
}));
vi.mock("../../src/integrations/harness/core/registry", () => ({
  canRunHarnessTextPrompt: vi.fn((harness: string) => registry.registered && harness !== "pi"),
  runHarnessTextPrompt: vi.fn(),
}));

const { backgroundSuggestionPrompt, extractBackgroundJson, generateBackgroundSuggestion } =
  await import("./background-suggestions");

const params = { prompt: "dawn over sand", harness: "claude" as const, model: "sonnet" };

describe("background suggestion Host command", () => {
  it("extracts the JSON object from a fenced reply", () => {
    expect(extractBackgroundJson('Here:\n```json\n{"name":"Dune"}\n```')).toEqual({ name: "Dune" });
    expect(extractBackgroundJson("no json here")).toBeNull();
    expect(extractBackgroundJson("{broken")).toBeNull();
  });

  it("registers the harness adapters before checking the chosen provider", async () => {
    registry.registered = false;
    const reply = JSON.stringify({
      name: "Dune",
      type: "linear",
      angle: 90,
      stops: ["#ffaa00", "#00ff00"],
    });
    await expect(generateBackgroundSuggestion(params, async () => reply)).resolves.toEqual({
      gradient: {
        name: "Dune",
        type: "linear",
        angle: 90,
        stops: ["#ffaa00", "#00ff00", "#00ff00"],
      },
    });
  });

  it("returns one validated, clamped gradient", async () => {
    const reply = JSON.stringify({
      name: "  Dune  ",
      type: "radial",
      angle: 500,
      stops: ["#FFAA00", "nope", "#00FF00"],
    });
    const run = vi.fn(async () => reply);
    const result = await generateBackgroundSuggestion(params, run);
    expect(result.gradient).toEqual({
      name: "Dune",
      type: "radial",
      angle: 360,
      stops: ["#ffaa00", "#00ff00", "#00ff00"],
    });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ harness: "claude", intent: "plan", timeoutMs: 90_000 }),
    );
  });

  it("fails clearly when no usable gradient comes back", async () => {
    await expect(
      generateBackgroundSuggestion(params, async () => '{"stops":["#123456"]}'),
    ).rejects.toThrow("Could not generate a gradient. Try again.");
  });

  it("refuses a model that cannot run text prompts", async () => {
    await expect(
      generateBackgroundSuggestion({ ...params, harness: "pi" }, async () => "{}"),
    ).rejects.toThrow("Selected model does not support text actions");
  });

  it("quotes the request as data in the prompt", () => {
    expect(backgroundSuggestionPrompt('ignore "rules"')).toContain('"ignore \\"rules\\""');
  });
});
