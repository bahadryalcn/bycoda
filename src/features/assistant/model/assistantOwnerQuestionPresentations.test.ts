import { expect, it, vi } from "vitest";
import {
  saveOwnerQuestionPresentation,
  pendingOwnerQuestionPresentations,
  retryOwnerQuestionPresentation,
  OwnerQuestionPresentationPending,
} from "./assistantOwnerQuestionPresentations";
function fixture() {
  const values = new Map<string, string>(),
    storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
  const value = saveOwnerQuestionPresentation(storage, {
    format: 1,
    environmentId: "host",
    input: {
      op: "questions.present",
      threadId: "thread",
      ownerMessageId: "owner",
      contextProjectIds: ["p"],
      requestId: "stable-request",
      causalContextId: "captured-context",
      questions: [
        {
          prompt: "Which result?",
          multiSelect: false,
          allowCustom: false,
          options: [{ label: "Keep" }, { label: "Review" }],
        },
      ],
    },
  });
  return { storage, value };
}
it("retains exact presentation identity through unknown delivery and does not retry automatically", async () => {
  const f = fixture(),
    port = vi.fn(async () => {
      throw new Error("unknown delivery");
    });
  await expect(
    retryOwnerQuestionPresentation(f.value, f.storage, port, () => true),
  ).rejects.toBeInstanceOf(OwnerQuestionPresentationPending);
  expect(port).toHaveBeenCalledExactlyOnceWith(f.value.input, "host");
  expect(pendingOwnerQuestionPresentations(f.storage, "host")).toEqual([f.value]);
  expect(pendingOwnerQuestionPresentations(f.storage, "different-host")).toEqual([]);
});
it("refuses immutable identity changes and hidden contributors before another creation request", async () => {
  const f = fixture(),
    port = vi.fn();
  await expect(
    retryOwnerQuestionPresentation(f.value, f.storage, port, () => false),
  ).rejects.toThrow("visibility");
  expect(port).not.toHaveBeenCalled();
  expect(() =>
    saveOwnerQuestionPresentation(f.storage, {
      ...f.value,
      input: { ...f.value.input, ownerMessageId: "different-owner" },
    }),
  ).toThrow("draft could not be saved");
  expect(pendingOwnerQuestionPresentations(f.storage, "host")).toEqual([f.value]);
});
