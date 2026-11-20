// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import type { AssistantMessage } from "../../../../shared/model/host-contracts/assistant";
import { createMessageProjection } from "./conversationMessageProjection";

const message = (id: string, jobIds: string[] = []) =>
  ({ id, role: "assistant", text: id, createdAt: 1, jobIds }) as unknown as AssistantMessage;
const jobs = (entries: [string, string][]) =>
  new Map(entries.map(([id, title]) => [id, { id, title }]));
const context = () => ({
  authorName: "Assistant",
  locale: "en",
  clearing: false,
  onJob: vi.fn(),
  onDelete: vi.fn(),
});

it("rebuilds only messages that link a changed job", () => {
  const project = createMessageProjection();
  const shared = context();
  const plain = message("plain");
  const linked = message("linked", ["job-1"]);
  const first = project([plain, linked], jobs([["job-1", "One"]]), shared);

  const unrelated = project(
    [plain, linked],
    jobs([
      ["job-1", "One"],
      ["job-2", "Other"],
    ]),
    shared,
  );
  expect(unrelated[0]).toBe(first[0]);
  expect(unrelated[1]).toBe(first[1]);

  const renamed = project([plain, linked], jobs([["job-1", "Renamed"]]), shared);
  expect(renamed[0]).toBe(first[0]);
  expect(renamed[1]).not.toBe(first[1]);

  const removed = project([plain, linked], jobs([]), shared);
  expect(removed[1]).not.toBe(renamed[1]);
});

it("rebuilds a replaced message and everything when the shared context changes", () => {
  const project = createMessageProjection();
  const shared = context();
  const a = message("a");
  const b = message("b");
  const first = project([a, b], jobs([]), shared);

  const edited = project([a, message("b")], jobs([]), shared);
  expect(edited[0]).toBe(first[0]);
  expect(edited[1]).not.toBe(first[1]);

  const clearing = project([a, b], jobs([]), { ...shared, clearing: true });
  expect(clearing[0]).not.toBe(first[0]);
  expect(clearing[1]).not.toBe(edited[1]);
});

it("drops items of messages that are no longer visible", () => {
  const project = createMessageProjection();
  const shared = context();
  const a = message("a");
  const b = message("b");
  const first = project([a, b], jobs([]), shared);
  project([b], jobs([]), shared);
  expect(project([a, b], jobs([]), shared)[0]).not.toBe(first[0]);
});
