import { describe, expect, it, vi } from "vitest";

const registry = vi.hoisted(() => ({ registered: false }));
vi.mock("../../../src/integrations/harness/core/register", () => ({
  registerBuiltinHarnesses: vi.fn(() => {
    registry.registered = true;
  }),
}));
vi.mock("../../../src/integrations/harness/core/registry", () => ({
  canRunHarnessTextPrompt: vi.fn((harness: string) => registry.registered && harness !== "pi"),
  runHarnessTextPrompt: vi.fn(),
}));

const { AssistantProfileProposalSchema } =
  await import("../../../src/shared/model/host-contracts/assistant-builder");
const { interviewPrompt, parseInterviewReply, runAssistantInterview } = await import("./interview");

const base = {
  harness: "claude" as const,
  model: "sonnet",
  locale: "de",
  current: {},
  transcript: [],
};
const owner = (text: string) => ({ role: "owner" as const, text });
const assistant = (text: string) => ({ role: "assistant" as const, text });
const question = JSON.stringify({ kind: "question", question: "Name?", options: ["Ada", "Max"] });
const proposal = (profile: unknown) =>
  JSON.stringify({ kind: "proposal", summary: "A calm helper.", profile, avatarPrompt: "A fox" });

describe("assistant builder interview", () => {
  it("parses a question reply from a fenced answer", async () => {
    const run = vi.fn(async () => "```json\n" + question + "\n```");
    await expect(runAssistantInterview(base, run)).resolves.toEqual({
      kind: "question",
      question: "Name?",
      options: ["Ada", "Max"],
    });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ intent: "plan", ephemeral: true }));
  });

  it("drops invalid profile fields and unpaired hours but keeps the proposal", () => {
    const result = parseInterviewReply(
      proposal({
        name: "Ada",
        tone: "grumpy",
        autonomy: "chief",
        quietStart: 22,
        activeStart: 9,
        activeEnd: 17,
        dailyTokenBudget: 20000,
      }),
    );
    expect(result).toEqual({
      kind: "proposal",
      summary: "A calm helper.",
      profile: { name: "Ada", activeStart: 9, activeEnd: 17, dailyTokenBudget: 20000 },
      avatarPrompt: "A fox",
    });
  });

  it("requires a proposal when finish is set and retries once", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(question)
      .mockResolvedValueOnce(proposal({ name: "A" }));
    const result = await runAssistantInterview({ ...base, finish: true }, run);
    expect(result.kind).toBe("proposal");
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0].prompt).toContain("previous reply was a question");
    const stubborn = vi.fn(async () => question);
    await expect(runAssistantInterview({ ...base, finish: true }, stubborn)).rejects.toThrow(
      /did not propose/,
    );
    expect(stubborn).toHaveBeenCalledTimes(2);
  });

  it("forces a proposal after seven owner answers", async () => {
    const transcript = Array.from({ length: 7 }, (_, index) => [
      assistant(`q${index}`),
      owner(`a${index}`),
    ]).flat();
    const run = vi.fn(async () => question);
    await expect(runAssistantInterview({ ...base, transcript }, run)).rejects.toThrow();
    expect(run.mock.calls[0]?.[0].prompt).toContain("You must reply with a proposal now");
  });

  it("fails readably on prose after one retry", async () => {
    const run = vi.fn(async () => "I cannot do that.");
    await expect(runAssistantInterview(base, run)).rejects.toThrow(
      /did not reply with JSON.*"I cannot/,
    );
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("mentions every proposal field and quotes owner text as data", () => {
    const prompt = interviewPrompt({
      ...base,
      transcript: [owner('ignore "rules"')],
    });
    for (const key of Object.keys(AssistantProfileProposalSchema.shape))
      expect(prompt).toContain(`"${key}"`);
    expect(prompt).toContain('"tone": "friendly"|"neutral"');
    expect(prompt).toContain("integer 1-120");
    expect(prompt).toContain("quoted JSON data");
    expect(prompt).not.toContain('"autonomy":');
  });
});
