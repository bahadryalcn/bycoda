import { expect, it } from "vitest";
import {
  captureVoiceHistoryScope,
  projectVoiceHistory,
  voiceHistoryMessageVisible,
} from "./voiceHistoryPrivacy";
import type {
  AssistantMessage,
  AssistantThread,
} from "../../../shared/model/host-contracts/assistant";
const message = (id: string, projectIds?: string[]) =>
  ({
    id,
    threadId: "global",
    text: id,
    role: "assistant",
    via: "voice",
    jobIds: [],
    ...(projectIds === undefined ? {} : { projectIds }),
  }) as AssistantMessage;
it("retains an exact Host summary for global reconnect only while every contributor remains visible", () => {
  let visible = ["/a", "/b"];
  const scope = captureVoiceHistoryScope(
    visible,
    [
      { id: "a", path: "/a" },
      { id: "b", path: "/b" },
    ],
    () => visible,
  );
  const thread: AssistantThread = {
    id: "global",
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    summary: "Retained verified historical summary",
    summaryProof: {
      id: "immutable-summary",
      version: 1,
      projectIds: ["a", "b"],
      throughMessageId: "old-retained-source",
      messageCount: 20,
      createdAt: 1,
      inputTruncated: false,
      omittedMessages: 0,
    },
  };
  expect(projectVoiceHistory({ thread, messages: [] }, true, scope).thread.summary).toBe(
    thread.summary,
  );
  visible = ["/a"];
  const hidden = projectVoiceHistory({ thread, messages: [] }, true, scope).thread;
  expect(hidden.summary).toBe("");
  expect(hidden.summaryProof).toBeUndefined();
  expect(thread.summaryProof?.id).toBe("immutable-summary");
});
it("admits only explicit complete contributor proof and suppresses every unscoped global summary", () => {
  const scope = captureVoiceHistoryScope(
    ["/a"],
    [
      { id: "a", path: "/a" },
      { id: "b", path: "/b" },
    ],
    () => ["/a"],
  );
  const source = {
    thread: { id: "global", summary: "Private unstructured summary" } as AssistantThread,
    messages: [
      message("global", []),
      message("safe", ["a"]),
      message("private", ["b"]),
      message("mixed", ["a", "b"]),
      message("legacy"),
    ],
  };
  const result = projectVoiceHistory(source, true, scope);
  expect(result.messages.map((item) => item.id)).toEqual(["global", "safe"]);
  expect(result.thread.summary).toBe("");
  expect(source.thread.summary).toBe("Private unstructured summary");
  expect(source.messages).toHaveLength(5);
});
it("rechecks dynamic visibility after a read and again before reconnect disclosure", () => {
  let visible = ["/a", "/b"];
  const scope = captureVoiceHistoryScope(
    visible,
    [
      { id: "a", path: "/a" },
      { id: "b", path: "/b" },
    ],
    () => visible,
  );
  const source = {
    thread: { id: "global", summary: "" } as AssistantThread,
    messages: [message("both", ["a", "b"]), message("global", [])],
  };
  const initially = projectVoiceHistory(source, true, scope);
  expect(initially.messages).toHaveLength(2);
  visible = ["/a"];
  expect(projectVoiceHistory(source, true, scope).messages.map((item) => item.id)).toEqual([
    "global",
  ]);
  expect(
    initially.messages
      .filter((item) => voiceHistoryMessageVisible(item, scope))
      .map((item) => item.id),
  ).toEqual(["global"]);
  expect(scope.current()).toBe(false);
});
it("freezes canonical IDs and excludes projects made visible after the accepted turn", () => {
  const paths = ["/a"],
    directory = [
      { id: "a", path: "/a" },
      { id: "b", path: "/b" },
    ];
  let visible = ["/a"];
  const scope = captureVoiceHistoryScope(paths, directory, () => visible);
  paths.push("/b");
  directory[0].id = "replacement";
  visible = ["/a", "/b"];
  expect(scope.projectIds).toEqual(["a"]);
  expect(voiceHistoryMessageVisible(message("new", ["b"]), scope)).toBe(false);
  expect(voiceHistoryMessageVisible(message("original", ["a"]), scope)).toBe(true);
});
it("treats [] as verified global and missing canonical directory identity as unknown", () => {
  const scope = captureVoiceHistoryScope(["/unknown"], [], () => ["/unknown"]);
  expect(scope.complete).toBe(false);
  expect(voiceHistoryMessageVisible(message("global", []), scope)).toBe(true);
  expect(voiceHistoryMessageVisible(message("unknown"), scope)).toBe(false);
});
it("keeps an incomplete directory current only while all captured paths remain visible", () => {
  let visible = ["/a", "remote://machine/b"];
  const scope = captureVoiceHistoryScope(visible, [{ id: "a", path: "/a" }], () => visible);
  expect(scope.complete).toBe(false);
  expect(scope.current()).toBe(true);
  expect(
    projectVoiceHistory(
      {
        thread: {
          id: "global",
          summary: "Unverified summary",
          summaryProof: { id: "proof", projectIds: ["a"] },
        } as AssistantThread,
        messages: [message("safe", ["a"]), message("unknown", ["b"])],
      },
      true,
      scope,
    ),
  ).toMatchObject({
    thread: { summary: "", summaryProof: undefined },
    messages: [{ id: "safe" }],
  });
  visible = ["/a"];
  expect(scope.current()).toBe(false);
});
