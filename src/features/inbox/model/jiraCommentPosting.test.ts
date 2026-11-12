// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { jiraIssueComment } from "./jira";
import type { JiraCommentImage } from "./jiraCommentDocument";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const issue = { id: "42", key: "ENG-42" };
const image = (id: string): JiraCommentImage => ({
  id,
  name: `${id}.png`,
  type: "image/png",
  dataUrl: "data:image/png;base64,iVBORw==",
});
beforeEach(() => vi.mocked(invoke).mockReset());

it("uploads images before posting ADF and keeps upload receipts after comment failure", async () => {
  const images = [image("screen")];
  vi.mocked(invoke)
    .mockResolvedValueOnce({ id: "7", url: "https://jira.example/attachment/7" })
    .mockRejectedValueOnce(new Error("Comment failed"));
  await expect(jiraIssueComment(issue, "**draft**", images)).rejects.toThrow("Comment failed");
  expect(invoke).toHaveBeenNthCalledWith(1, "jira_issue_attachment", {
    key: "ENG-42",
    name: "screen.png",
    mimeType: "image/png",
    dataBase64: "iVBORw==",
  });
  expect(invoke).toHaveBeenNthCalledWith(
    2,
    "jira_issue_comment",
    expect.objectContaining({
      key: "ENG-42",
      body: "**draft**",
      document: expect.objectContaining({ type: "doc", version: 1 }),
    }),
  );
  expect(images[0].uploaded?.id).toBe("7");
  vi.mocked(invoke).mockResolvedValueOnce("comment-url");
  await expect(jiraIssueComment(issue, "**draft**", images)).resolves.toBe("comment-url");
  expect(
    vi.mocked(invoke).mock.calls.filter(([command]) => command === "jira_issue_attachment"),
  ).toHaveLength(1);
});

it("preserves successful uploads when a later upload fails and never posts an incomplete comment", async () => {
  const images = [image("one"), image("two")];
  vi.mocked(invoke)
    .mockResolvedValueOnce({ id: "7", url: "https://jira.example/attachment/7" })
    .mockRejectedValueOnce(new Error("Upload failed"));
  await expect(jiraIssueComment(issue, "draft", images)).rejects.toThrow("Upload failed");
  expect(images[0].uploaded?.id).toBe("7");
  expect(images[1].uploaded).toBeUndefined();
  expect(invoke).not.toHaveBeenCalledWith("jira_issue_comment", expect.anything());
  vi.mocked(invoke)
    .mockResolvedValueOnce({ id: "8", url: "https://jira.example/attachment/8" })
    .mockResolvedValueOnce("comment-url");
  await jiraIssueComment(issue, "draft", images);
  expect(
    vi.mocked(invoke).mock.calls.filter(([command]) => command === "jira_issue_attachment"),
  ).toHaveLength(3);
});
