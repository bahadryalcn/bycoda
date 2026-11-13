import { expect, it } from "vitest";
import type { Block } from "./session";
import { collapseTranscriptErrors } from "./transcriptErrors";

const user: Block = { id: "user", role: "user", text: "Continue" };
const limit = "You've hit your weekly limit · resets 8am (Europe/Istanbul)";
const error = (id: string, text = limit): Block => ({ id, role: "system", notice: "error", text });

it("shows one equivalent failure per user attempt without changing stored blocks", () => {
  const blocks = [user, error("one"), error("two", `${limit} (HTTP 429)`), error("three")];
  expect(collapseTranscriptErrors(blocks)).toEqual([user, blocks[1]]);
  expect(blocks).toHaveLength(4);
  expect(blocks[2].text).toBe(`${limit} (HTTP 429)`);
});

it("keeps separate failures and repeated failures in separate attempts", () => {
  const blocks = [
    user,
    error("one"),
    error("different", "Could not save conversation"),
    { ...user, id: "retry" },
    error("retry-error"),
  ];
  expect(collapseTranscriptErrors(blocks)).toBe(blocks);
});

it("does not hide assistant output or different reset windows", () => {
  const blocks: Block[] = [
    user,
    error("one"),
    { id: "answer", role: "assistant", text: limit },
    error("later", limit.replace("8am", "9am")),
  ];
  expect(collapseTranscriptErrors(blocks)).toBe(blocks);
});

it("keeps a new failure after a handoff without a new user prompt", () => {
  const blocks: Block[] = [
    user,
    error("one"),
    { id: "handoff", role: "handoff", text: "Handoff" },
    error("two"),
  ];
  expect(collapseTranscriptErrors(blocks)).toBe(blocks);
});
