// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { prepareQuestionAttachments } from "./questionAttachments";
import { buildQuestionReply, selectedAnswerLabels, type UserQuestion } from "./userQuestion";
const file = {
  id: "image",
  name: "shot.png",
  mimeType: "image/png",
  kind: "image" as const,
  size: 3,
};
const question: UserQuestion = {
  id: "q",
  prompt: "Show me",
  allowCustom: true,
  multiSelect: false,
  options: [],
};
beforeEach(() => {
  invoke.mockReset();
});
describe("question file answers", () => {
  it("saves pasted images before returning durable metadata", async () => {
    invoke.mockResolvedValue("/saved/shot.png");
    expect(
      await prepareQuestionAttachments([{ ...file, data: "YWJj", previewUrl: "blob:shot" }]),
    ).toEqual([{ ...file, path: "/saved/shot.png" }]);
    expect(invoke).toHaveBeenCalledWith("write_attachment", { name: "shot.png", data: "YWJj" });
  });
  it("keeps disk paths without copying or reading their contents", async () => {
    const files = [{ ...file, path: "/saved/shot.png", hostEnvironmentId: "host" }];
    expect(await prepareQuestionAttachments(files)).toEqual(files);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("surfaces saving failure and rejects missing file sources", async () => {
    invoke.mockImplementation(() => {
      throw new Error("disk full");
    });
    await expect(prepareQuestionAttachments([{ ...file, data: "YWJj" }])).rejects.toThrow(
      "disk full",
    );
    await expect(prepareQuestionAttachments([file])).rejects.toThrow("no file data");
  });
  it("answers with files alone and includes paths in string-only provider replies", () => {
    const reply = buildQuestionReply(
      [question],
      {},
      {},
      { q: [{ ...file, path: "/saved/shot.png" }] },
    );
    expect(reply.kind).toBe("answered");
    if (reply.kind !== "answered") throw new Error("Expected answer");
    expect(selectedAnswerLabels(question, reply)).toEqual([
      'Attached file (read from disk): "/saved/shot.png"',
    ]);
  });
  it("keeps typed schema fields exact and excludes attached files", () => {
    const typed = { ...question, preserveCustomWhitespace: true };
    const reply = buildQuestionReply(
      [typed],
      {},
      { q: " 12 " },
      { q: [{ ...file, path: "/saved/shot.png" }] },
    );
    expect(reply).toEqual({ kind: "answered", answers: {}, custom: { q: " 12 " } });
    if (reply.kind === "answered") expect(selectedAnswerLabels(typed, reply)).toEqual([" 12 "]);
  });
  it("retains choice and text alongside file reference in single-answer protocols", () => {
    const reply = buildQuestionReply(
      [question],
      {},
      { q: "Use this" },
      { q: [{ ...file, path: "/saved/shot.png" }] },
    );
    if (reply.kind !== "answered") throw new Error("Expected answer");
    expect(selectedAnswerLabels(question, reply)[0]).toContain("Use this\n\nAttached file");
  });
});
