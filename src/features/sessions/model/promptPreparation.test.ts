import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyFileMentionsToTurn: vi.fn(),
  applyNotesToTurn: vi.fn(),
  applySkillsToTurn: vi.fn(),
  events: [] as string[],
  warmNativeSkills: vi.fn(),
}));

vi.mock("../../files/model/fileMentions", () => ({
  applyFileMentionsToTurn: mocks.applyFileMentionsToTurn,
}));

vi.mock("../../notes", () => ({
  applyNotesToTurn: mocks.applyNotesToTurn,
}));

vi.mock("../../skills/model/skills", () => ({
  applySkillsToTurn: mocks.applySkillsToTurn,
  warmNativeSkills: mocks.warmNativeSkills,
  isNativeCommandPrompt: (text: string, harness: string) =>
    harness === "omp" && text.startsWith("/"),
}));

import { preparePrompt } from "./promptPreparation";
import { withChatCitations, type ChatCitation } from "./chatCitation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.events.length = 0;
  mocks.applyFileMentionsToTurn.mockReset();
  mocks.applyNotesToTurn.mockReset();
  mocks.applyNotesToTurn.mockImplementation(async (text: string) => text);
  mocks.applySkillsToTurn.mockReset();
  mocks.warmNativeSkills.mockReset();
  mocks.warmNativeSkills.mockImplementation(() => {
    mocks.events.push("warm");
  });
});

describe("preparePrompt", () => {
  it("keeps cited mentions out of file/notes/skill expansion and gives providers readable snapshots", async () => {
    const quote: ChatCitation = {
      version: 1,
      id: "c",
      sessionId: "s",
      blockId: "b",
      text: "@secret $danger",
      sourceText: "@secret $danger",
      occurrence: 0,
      comment: "Only discuss this quote",
    };
    mocks.applyFileMentionsToTurn.mockImplementation(async (text: string) => text);
    mocks.applySkillsToTurn.mockImplementation(async (text: string) => text);
    const prepared = await preparePrompt(withChatCitations("Explain this", [quote]), {
      harness: "claude",
      cwd: "/repo",
    });
    expect(mocks.applyFileMentionsToTurn).toHaveBeenCalledWith("Explain this", "/repo");
    expect(mocks.applyNotesToTurn).toHaveBeenCalledWith("Explain this");
    expect(mocks.applySkillsToTurn).toHaveBeenCalledWith("Explain this", {
      harness: "claude",
      cwd: "/repo",
    });
    expect(prepared).toContain('"quote": "@secret $danger"');
    expect(prepared).toContain('"comment": "Only discuss this quote"');
    expect(prepared).not.toContain("bycoda-citation:");
  });
  it.each(["/workflow foo @README.md", "/Review_Code a:b", "/omp:compact custom instructions"])(
    "preserves native command arguments: %s",
    async (text) => {
      await expect(preparePrompt(text, { harness: "omp", cwd: "/repo" })).resolves.toBe(
        text.replace("/omp:compact", "/compact"),
      );
      expect(mocks.applyFileMentionsToTurn).not.toHaveBeenCalled();
      expect(mocks.applyNotesToTurn).not.toHaveBeenCalled();
      expect(mocks.applySkillsToTurn).not.toHaveBeenCalled();
    },
  );
  it("starts warmup before awaiting file mentions", async () => {
    const files = deferred<string>();
    mocks.applyFileMentionsToTurn.mockImplementation(() => {
      mocks.events.push("files");
      return files.promise;
    });
    mocks.applySkillsToTurn.mockResolvedValue("prepared");

    const preparation = preparePrompt("hello", {
      harness: "pi",
      cwd: "/repo",
    });
    expect(mocks.events).toEqual(["warm", "files"]);

    files.resolve("with files");
    await expect(preparation).resolves.toBe("prepared");
    expect(mocks.applyNotesToTurn).toHaveBeenCalledWith("with files");
    expect(mocks.applySkillsToTurn).toHaveBeenCalledWith("with files", {
      harness: "pi",
      cwd: "/repo",
    });
  });
});
