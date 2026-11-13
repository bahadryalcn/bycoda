import { expect, it } from "vitest";
import {
  BUILDER_MAX_TURNS,
  BUILDER_MAX_TURN_TEXT,
  appendBuilderTurn,
  builderEntries,
  builderPatch,
  proposalFromDraft,
  type BuilderFieldKey,
} from "./assistantBuilder";
import { AssistantProfileInterviewParamsSchema } from "../../../shared/model/host-contracts/assistant-builder";

it("keeps the transcript inside the contract's 30 turns and 2000 characters", () => {
  let transcript = appendBuilderTurn([], { role: "assistant", text: "x".repeat(5000) });
  expect(transcript[0]?.text).toHaveLength(BUILDER_MAX_TURN_TEXT);
  for (let index = 0; index < 40; index += 1)
    transcript = appendBuilderTurn(transcript, { role: "owner", text: `answer ${index}` });
  expect(transcript).toHaveLength(BUILDER_MAX_TURNS);
  expect(transcript.at(-1)?.text).toBe("answer 39");
  expect(appendBuilderTurn(transcript, { role: "owner", text: "   " })).toEqual(transcript);
});

it("sends only proposable, valid draft fields as the current profile", () => {
  const current = proposalFromDraft({
    name: "Ada",
    tone: "blunt",
    autonomy: "chief",
    avatar: "preset:fox",
    execution: null,
    enabled: true,
    permissionLevel: "everything",
    permissionProjectIds: ["private-project"],
    criticalExclusions: [],
    notificationTelegram: { accountId: "account", conversationId: "conversation" },
    dailyTokenBudget: -5,
    quietStart: 22,
  });
  expect(current).toEqual({ name: "Ada", tone: "blunt", quietStart: 22 });
  expect(
    AssistantProfileInterviewParamsSchema.safeParse({
      harness: "codex",
      model: "gpt",
      locale: "en",
      current,
      transcript: [],
    }).success,
  ).toBe(true);
});

it("lists only proposed fields that change the draft, in display order", () => {
  const entries = builderEntries(
    { name: "Ada", tone: "friendly", quietStart: 22 },
    { quietStart: 23, tone: "blunt", name: "Ada", showTitle: true },
  );
  expect(entries.map((entry) => entry.key)).toEqual(["showTitle", "tone", "quietStart"]);
  const tone = entries.find((entry) => entry.key === "tone");
  expect(tone).toMatchObject({ before: expect.any(String), after: expect.any(String) });
  expect(tone?.before).not.toBe(tone?.after);
  expect(entries.find((entry) => entry.key === "showTitle")?.before).toBe("—");
  expect(entries.find((entry) => entry.key === "quietStart")).toMatchObject({
    before: "22:00",
    after: "23:00",
  });
});

it("merges only checked fields, the edited persona and the generated avatar", () => {
  const entries = builderEntries({}, { name: "Nova", tone: "casual", persona: "Short answers." });
  const checked = new Set<BuilderFieldKey>(["name", "persona"]);
  expect(
    builderPatch(entries, checked, { persona: "Short, warm answers.", avatar: "image:a" }),
  ).toEqual({
    name: "Nova",
    persona: "Short, warm answers.",
    avatar: "image:a",
  });
  expect(builderPatch(entries, new Set(), {})).toEqual({});
  expect(builderPatch(entries, new Set<BuilderFieldKey>(["tone"]), { persona: "ignored" })).toEqual(
    {
      tone: "casual",
    },
  );
});
