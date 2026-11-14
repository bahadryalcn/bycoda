import { afterEach, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({ run: vi.fn(), resolve: vi.fn() }));
vi.mock("../../../integrations/harness/core/registry", () => ({
  runHarnessTextPrompt: provider.run,
  canRunHarnessTextPrompt: () => true,
}));
vi.mock("../../sessions/public/models", () => ({
  isModelEnabled: () => true,
  modelBelongsToHarness: () => true,
}));
vi.mock("../../sessions/public/titlePreferences", () => ({
  titleGenerationChoice: () => undefined,
}));
vi.mock("./helperModelRouting", () => ({
  resolveHelperModel: provider.resolve,
}));

import type { SetupCandidate } from "./smartSetup";
import {
  applySetupRefinement,
  buildSetupPrompt,
  parseSetupRefinement,
  refineSetupCandidates,
} from "./smartSetupAi";

const make = (
  model: string,
  estimated: boolean,
  account?: SetupCandidate["account"],
): SetupCandidate => ({
  target: {
    harness: "codex",
    model,
    ...(account ? { providerAccountId: account.id } : {}),
    modelSettings: {},
  },
  modelName: model,
  ...(account ? { account } : {}),
  profile: { intelligence: 3, cost: 2, estimated },
});

const goodAnswer = JSON.stringify({
  models: [{ harness: "codex", model: "mystery", intelligence: 5, cost: 3 }],
  accounts: [],
});

afterEach(() => {
  vi.useRealTimers();
  provider.run.mockReset();
  provider.resolve.mockReset();
});

it("lists only estimated models and kind-less accounts in the prompt", () => {
  const prompt = buildSetupPrompt([
    make("known", false, { id: "a", label: "Work", kind: "work" }),
    make("mystery", true, { id: "b", label: "Spare" }),
  ]);
  expect(prompt).toContain("mystery");
  expect(prompt).not.toContain('"model":"known"');
  expect(prompt).toContain('"id":"b"');
  expect(prompt).not.toContain('"id":"a"');
});

it("parses strictly and tolerates a code fence", () => {
  expect(parseSetupRefinement("```json\n" + goodAnswer + "\n```")?.models).toHaveLength(1);
  for (const text of [
    "nope",
    "{}",
    JSON.stringify({
      models: [{ harness: "codex", model: "m", intelligence: 9, cost: 2 }],
      accounts: [],
    }),
    JSON.stringify({
      models: [],
      accounts: [{ harness: "codex", id: "a", kind: "boss" }],
    }),
  ])
    expect(parseSetupRefinement(text)).toBeUndefined();
});

it("applies answers only to estimated profiles and kind-less accounts", () => {
  const candidates = [
    make("known", false, { id: "a", label: "Work", kind: "work" }),
    make("mystery", true, { id: "b", label: "Spare" }),
    make("mystery", true, { id: "c", label: "Other" }),
  ];
  const result = applySetupRefinement(candidates, {
    models: [
      { harness: "codex", model: "known", intelligence: 1, cost: 1 },
      { harness: "codex", model: "mystery", intelligence: 5, cost: 4 },
    ],
    accounts: [
      { harness: "codex", id: "a", kind: "personal" },
      { harness: "codex", id: "b", kind: "personal" },
      { harness: "codex", id: "c", kind: "shared" },
    ],
  });
  expect(result[0]).toEqual(candidates[0]);
  expect(result[1].profile).toEqual({
    intelligence: 5,
    cost: 4,
    estimated: true,
  });
  expect(result[1].account?.kind).toBe("personal");
  expect(result[2].account?.kind).toBeUndefined();
});

it("skips the model call when nothing is unknown", async () => {
  const candidates = [make("known", false, { id: "a", label: "Work", kind: "work" })];
  expect(await refineSetupCandidates(candidates, {})).toEqual({
    candidates,
    refined: false,
  });
  expect(provider.resolve).not.toHaveBeenCalled();
});

it("refines through the routing helper model", async () => {
  provider.resolve.mockResolvedValue({
    harness: "codex",
    model: "helper",
    modelSettings: {},
  });
  provider.run.mockResolvedValue(goodAnswer);
  const result = await refineSetupCandidates([make("mystery", true)], {});
  expect(result.refined).toBe(true);
  expect(result.candidates[0].profile.intelligence).toBe(5);
  expect(provider.resolve).toHaveBeenCalledWith("text.routingSetup");
  expect(provider.run).toHaveBeenCalledWith(
    expect.objectContaining({
      model: "helper",
      ephemeral: true,
      timeoutMs: expect.any(Number),
    }),
  );
});

it("never rejects: no model, garbage, failure and hang fall back", async () => {
  const candidates = [make("mystery", true)];
  expect(await refineSetupCandidates(candidates, {})).toEqual({
    candidates,
    refined: false,
  });
  provider.resolve.mockResolvedValue({
    harness: "codex",
    model: "helper",
    modelSettings: {},
  });
  provider.run.mockResolvedValueOnce("garbage");
  expect((await refineSetupCandidates(candidates, {})).refined).toBe(false);
  provider.run.mockRejectedValueOnce(new Error("offline"));
  expect((await refineSetupCandidates(candidates, {})).refined).toBe(false);
  vi.useFakeTimers();
  provider.run.mockReturnValueOnce(new Promise(() => {}));
  const pending = refineSetupCandidates(candidates, {});
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await pending).toEqual({ candidates, refined: false });
  expect(provider.run.mock.calls.at(-1)?.[0].signal.aborted).toBe(true);
});
