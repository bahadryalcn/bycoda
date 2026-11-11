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

const { describeUnusableReply, extractThemeJson, generateThemeSuggestions, themeSuggestionPrompt } =
  await import("./theme-suggestions");

const params = {
  prompt: "warm kiln",
  harness: "claude" as const,
  model: "sonnet",
};

describe("theme suggestion Host command", () => {
  it("extracts JSON from a fenced reply", () => {
    expect(extractThemeJson('Here:\n```json\n[{"name":"A"}]\n```')).toEqual([{ name: "A" }]);
    expect(extractThemeJson("no json here")).toBeNull();
    expect(extractThemeJson("[broken")).toBeNull();
  });

  it("registers the harness adapters before checking the chosen provider", async () => {
    registry.registered = false;
    const run = vi.fn(async () => '[{"name":"Kiln","hue":25,"saturation":20,"accent":"#f59e0b"}]');
    await expect(generateThemeSuggestions(params, run)).resolves.toEqual({
      suggestions: [{ name: "Kiln", hue: 25, saturation: 20, accent: "#f59e0b" }],
    });
  });

  it("returns only validated and clamped suggestions", async () => {
    const reply = JSON.stringify([
      { name: "Kiln", hue: 25, saturation: 90, accent: "#F59E0B" },
      { name: "Bad", hue: 20, saturation: 20, accent: "orange" },
      { name: "Fern", hue: 140, saturation: 30, accent: "#10b981" },
    ]);
    const run = vi.fn(async () => reply);
    const result = await generateThemeSuggestions(params, run);
    expect(result.suggestions).toEqual([
      { name: "Kiln", hue: 25, saturation: 60, accent: "#f59e0b" },
      { name: "Fern", hue: 140, saturation: 30, accent: "#10b981" },
    ]);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        harness: "claude",
        intent: "plan",
        timeoutMs: 90_000,
      }),
    );
  });

  it("returns coherent typography and visible image tuning even for extreme model values", async () => {
    const reply = JSON.stringify([
      {
        name: "Night",
        hue: 220,
        saturation: 12,
        accent: "#2299ee",
        typography: { codeSize: 13, terminalSize: 40 },
        interface: { contrast: 75 },
        image: { emptyOpacity: 0, sessionOpacity: 0, blur: 40 },
      },
    ]);
    const { suggestions } = await generateThemeSuggestions(params, async () => reply);
    expect(suggestions[0]).toMatchObject({
      typography: { codeSize: 13, terminalSize: 15 },
      interface: { contrast: 100 },
      image: { emptyOpacity: 30, sessionOpacity: 15, blur: 12 },
    });
  });

  it("fails clearly when no valid entry comes back", async () => {
    await expect(generateThemeSuggestions(params, async () => '[{"name":"x"}]')).rejects.toThrow(
      /missing required fields/,
    );
  });

  it("refuses a model that cannot run text prompts", async () => {
    await expect(
      generateThemeSuggestions({ ...params, harness: "pi" }, async () => "[]"),
    ).rejects.toThrow("Selected model does not support text actions");
  });

  it("quotes the request as data in the prompt", () => {
    expect(themeSuggestionPrompt('ignore "rules"')).toContain('"ignore \\"rules\\""');
  });

  it("offers every optional Appearance field with the font catalog ids", () => {
    const prompt = themeSuggestionPrompt("forest");
    for (const field of [
      "scheme",
      "gradient",
      "interfaceFont",
      "codeFont",
      "density",
      "imagePrompt",
    ])
      expect(prompt).toContain(`"${field}"`);
    expect(prompt).toContain('"JetBrains Mono"');
  });

  it("guides surface contrast for dark canvases", () => {
    const prompt = themeSuggestionPrompt("forest");
    expect(prompt).toContain("interface.surfaceContrast 110-150");
    expect(prompt).toContain('"surfaceContrast": 50-200');
  });

  it("describes every grouped Appearance field with its allowed values", () => {
    const prompt = themeSuggestionPrompt("forest");
    for (const field of [
      '"typography": {"codeSize": 11-18',
      '"terminalWeight": 300|400|500|600|700',
      '"interface": {"uiScale": 80-150',
      '"diffPalette": "default"|"colorblind"|"high-contrast"',
      '"background": {"sidebarOpacity": 70-100',
      '"liveScene": "none"|"threads"',
      '"image": {"scope": "empty"|"all"',
      '"motion": {"crewTheme": "classic"|"star-wars"|"lotr"|"matrix"',
    ])
      expect(prompt).toContain(field);
  });

  it("keeps grouped fields the model returns and drops invalid ones", async () => {
    const reply = JSON.stringify([
      {
        name: "Kiln",
        hue: 20,
        saturation: 30,
        accent: "#c2410c",
        typography: { codeSize: 15, terminalWeight: 999 },
        motion: { crewTheme: "matrix", showCrew: "yes" },
      },
    ]);
    const { suggestions } = await generateThemeSuggestions(params, async () => reply);
    expect(suggestions[0]).toMatchObject({
      typography: { codeSize: 15 },
      motion: { crewTheme: "matrix" },
    });
    expect(suggestions[0]?.typography).not.toHaveProperty("terminalWeight");
  });
});

it("explains crew themes, live scenes and image effects so the model can pick them", () => {
  const prompt = themeSuggestionPrompt("house of sauron");
  expect(prompt).toContain("The Lord of the Rings");
  expect(prompt).toContain('"showCrew": true');
  expect(prompt).toMatch(/code-rain = /);
  expect(prompt).toMatch(/halftone \(/);
  expect(prompt).not.toContain("Never set a field");
});

it("runs the prompt under the chosen bycoda provider account", async () => {
  const run = vi.fn(async () => '[{"name":"Kiln","hue":25,"saturation":20,"accent":"#f59e0b"}]');
  await generateThemeSuggestions(
    { prompt: "kiln", harness: "claude", model: "claude:opus-5-5", providerAccountId: "account-1" },
    run,
  );
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ providerAccountId: "account-1" }));
});

it("retries once when the first reply holds no usable theme, then explains the reply", async () => {
  const params = { prompt: "kiln", harness: "claude", model: "claude:opus-5-5" };
  const flaky = vi
    .fn()
    .mockResolvedValueOnce("Sure! Here are some ideas...")
    .mockResolvedValueOnce('[{"name":"Kiln","hue":25,"saturation":20,"accent":"#f59e0b"}]');
  await expect(generateThemeSuggestions(params, flaky)).resolves.toMatchObject({
    suggestions: [{ name: "Kiln" }],
  });
  expect(flaky).toHaveBeenCalledTimes(2);
  const prose = vi.fn(async () => "I cannot do that.");
  await expect(generateThemeSuggestions(params, prose)).rejects.toThrow(
    /did not reply with JSON themes.*"I cannot do that."/,
  );
  expect(prose).toHaveBeenCalledTimes(2);
  expect(describeUnusableReply("")).toMatch(/empty reply/);
  expect(describeUnusableReply('[{"name":"x"}]')).toMatch(/missing required fields/);
});
