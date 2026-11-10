import { describe, expect, it } from "vitest";
import { appendVoiceChatTurn, nextVoiceChatTurns } from "./useVoiceChatTurns";
import { voiceJobsNeedReview } from "./voiceJobAutoStart";
import type { VoiceJobDraft } from "../../model/voiceJobs";

describe("appendVoiceChatTurn", () => {
  it("adds owner and assistant lines as separate bubbles", () => {
    const turns = appendVoiceChatTurn(
      appendVoiceChatTurn([], "owner", "Open the tests"),
      "assistant",
      "Done.",
    );
    expect(turns.map((turn) => [turn.role, turn.text])).toEqual([
      ["owner", "Open the tests"],
      ["assistant", "Done."],
    ]);
  });

  it("grows a streamed reply in place instead of adding a bubble per update", () => {
    let turns = appendVoiceChatTurn([], "assistant", "The tests");
    turns = appendVoiceChatTurn(turns, "assistant", "The tests are passing.");
    expect(turns).toHaveLength(1);
    expect(turns[0]!.text).toBe("The tests are passing.");
  });

  it("ignores blank text and an exact repeat of the last line", () => {
    const first = appendVoiceChatTurn([], "owner", "Hello");
    expect(appendVoiceChatTurn(first, "owner", "   ")).toHaveLength(1);
    expect(appendVoiceChatTurn(first, "owner", "Hello")).toHaveLength(1);
  });

  it("keeps only the most recent lines", () => {
    let turns: ReturnType<typeof appendVoiceChatTurn> = [];
    for (let index = 0; index < 40; index++)
      turns = appendVoiceChatTurn(turns, index % 2 ? "owner" : "assistant", `line ${index}`);
    expect(turns).toHaveLength(16);
    expect(turns.at(-1)!.text).toBe("line 39");
  });
});

describe("nextVoiceChatTurns", () => {
  const lines = (turns: ReturnType<typeof nextVoiceChatTurns>) =>
    turns.map((turn) => [turn.role, turn.text]);

  it("shows the same words spoken again as a new owner line", () => {
    let seen = { transcript: "", message: "", visible: true, ownerTurn: 0 };
    let turns: ReturnType<typeof nextVoiceChatTurns> = [];
    for (const now of [
      { ...seen, transcript: "Selam Arif.", ownerTurn: 1 },
      { ...seen, transcript: "Selam Arif.", ownerTurn: 1, message: "Selam Bahadır! Nasılsın?" },
      // Same text, so only the turn counter tells the two utterances apart.
      { ...seen, transcript: "Selam Arif.", ownerTurn: 2, message: "Selam Bahadır! Nasılsın?" },
      { ...seen, transcript: "Selam Arif.", ownerTurn: 2, message: "Selam Bahadır! Buradayım." },
    ]) {
      turns = nextVoiceChatTurns(turns, seen, now);
      seen = now;
    }
    expect(lines(turns)).toEqual([
      ["owner", "Selam Arif."],
      ["assistant", "Selam Bahadır! Nasılsın?"],
      ["owner", "Selam Arif."],
      ["assistant", "Selam Bahadır! Buradayım."],
    ]);
  });

  it("adds a repeated owner line even before any reply, and clears lines when hidden", () => {
    const first = { transcript: "Bekle", message: "", visible: true, ownerTurn: 1 };
    let turns = nextVoiceChatTurns([], {}, first);
    turns = nextVoiceChatTurns(turns, first, { ...first, ownerTurn: 2 });
    expect(lines(turns)).toEqual([
      ["owner", "Bekle"],
      ["owner", "Bekle"],
    ]);
    expect(nextVoiceChatTurns(turns, first, { ...first, visible: false })).toEqual([]);
  });
});

describe("voiceJobsNeedReview", () => {
  const ready = {
    id: "1",
    kind: "project",
    title: "Title",
    request: "Request",
    projectId: "pa",
    projectIds: ["pa"],
  } as unknown as VoiceJobDraft;
  const capabilities = { quickNotes: false, quickAutomations: false };
  const isReady = (row: VoiceJobDraft) => row.title.trim().length > 0;

  it("starts ready jobs directly when review is off or unset", () => {
    expect(voiceJobsNeedReview([ready], capabilities, false, isReady)).toBe(false);
    expect(voiceJobsNeedReview([ready], capabilities, undefined, isReady)).toBe(false);
  });

  it("keeps the review when the owner asked for it", () => {
    expect(voiceJobsNeedReview([ready], capabilities, true, isReady)).toBe(true);
  });

  it("falls back to the review when a draft is incomplete", () => {
    const blank = { ...ready, title: "" } as VoiceJobDraft;
    expect(voiceJobsNeedReview([blank], capabilities, false, isReady)).toBe(true);
  });
});
