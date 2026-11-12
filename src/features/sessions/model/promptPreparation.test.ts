import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyFileMentionsToTurn: vi.fn(),
  applyNotesToTurn: vi.fn(),
  applyWorkItemMentionsToTurn: vi.fn(),
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

vi.mock("../../inbox/public/workItemMentions", () => ({
  applyWorkItemMentionsToTurn: mocks.applyWorkItemMentionsToTurn,
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
  mocks.applyWorkItemMentionsToTurn.mockReset();
  mocks.applyWorkItemMentionsToTurn.mockImplementation(async (text: string) => text);
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
      text: "@secret $danger @jira:PROJ-123",
      sourceText: "@secret $danger @jira:PROJ-123",
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
    expect(mocks.applyWorkItemMentionsToTurn).toHaveBeenCalledWith("Explain this", "/repo");
    expect(mocks.applySkillsToTurn).toHaveBeenCalledWith("Explain this", {
      harness: "claude",
      cwd: "/repo",
    });
    expect(prepared).toContain('"quote": "@secret $danger @jira:PROJ-123"');
    expect(prepared).toContain('"comment": "Only discuss this quote"');
    expect(prepared).not.toContain("bycoda-citation:");
  });
  it.each([
    "/workflow foo @README.md @jira:PROJ-123",
    "/Review_Code a:b",
    "/omp:compact custom instructions",
  ])("preserves native command arguments: %s", async (text) => {
    await expect(preparePrompt(text, { harness: "omp", cwd: "/repo" })).resolves.toBe(
      text.replace("/omp:compact", "/compact"),
    );
    expect(mocks.applyFileMentionsToTurn).not.toHaveBeenCalled();
    expect(mocks.applyNotesToTurn).not.toHaveBeenCalled();
    expect(mocks.applyWorkItemMentionsToTurn).not.toHaveBeenCalled();
    expect(mocks.applySkillsToTurn).not.toHaveBeenCalled();
  });
  it.each(["/repo", "remote://host-a/srv/repo"])(
    "expands work items after notes and before skills using the owning cwd (%s)",
    async (cwd) => {
      mocks.applyFileMentionsToTurn.mockResolvedValue("files");
      mocks.applyNotesToTurn.mockResolvedValue("notes @jira:PROJ-123");
      mocks.applyWorkItemMentionsToTurn.mockResolvedValue("work items");
      mocks.applySkillsToTurn.mockImplementation(async (text: string) => text);
      await expect(preparePrompt("@jira:PROJ-123", { harness: "claude", cwd })).resolves.toBe(
        "work items",
      );
      expect(mocks.applyNotesToTurn).toHaveBeenCalledWith("files");
      expect(mocks.applyWorkItemMentionsToTurn).toHaveBeenCalledWith("notes @jira:PROJ-123", cwd);
      expect(mocks.applySkillsToTurn).toHaveBeenCalledWith("work items", {
        harness: "claude",
        cwd,
      });
    },
  );
  it("preserves the prompt and continues skills when tracker expansion fails", async () => {
    mocks.applyFileMentionsToTurn.mockImplementation(async (text: string) => text);
    mocks.applyWorkItemMentionsToTurn.mockRejectedValue(new Error("offline"));
    mocks.applySkillsToTurn.mockImplementation(async (text: string) => text);
    await expect(
      preparePrompt("@jira:PROJ-123", { harness: "claude", cwd: "/repo" }),
    ).resolves.toBe("@jira:PROJ-123");
  });
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
