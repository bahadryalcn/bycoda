import { expect, it, vi } from "vitest";
import type { AssistantNote } from "../../../shared/model/host-contracts/assistant";
import { AssistantNoteDraft } from "./assistantNoteDraft";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
const note = (overrides: Partial<AssistantNote> = {}): AssistantNote => ({
  id: "stable-note",
  title: "Owner note",
  body: "Exact owner body",
  tags: ["assistant"],
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
});

it("allocates and retains a create identity and migrated text through cancel/reopen before saving", async () => {
  const disk = storage();
  disk.setItem("bycoda.assistant.note-draft:new:title", "Owner note");
  disk.setItem("bycoda.assistant.note-draft:new:body", "Exact owner body");
  const first = new AssistantNoteDraft(null, disk, () => "stable-note", "host-original");
  const reopened = new AssistantNoteDraft(null, disk, () => "wrong-new-id", "host-original");
  expect(reopened.value).toMatchObject({
    id: first.value.id,
    title: "Owner note",
    body: "Exact owner body",
    expectedUpdatedAt: 0,
  });
  const request = vi.fn(async (): Promise<any> => ({ note: note() }));
  await reopened.save(request);
  expect(request).toHaveBeenCalledExactlyOnceWith(
    {
      op: "notes.save",
      id: "stable-note",
      title: "Owner note",
      body: "Exact owner body",
      expectedUpdatedAt: 0,
    },
    "host-original",
  );
});
it("reconciles a lost create acknowledgement by exact ID after remount without a second write", async () => {
  const disk = storage(),
    first = new AssistantNoteDraft(null, disk, () => "stable-note", "host-original");
  first.update({ title: "Owner note", body: "Exact owner body" });
  const lost = vi.fn(async (): Promise<any> => {
    throw new Error("Reply lost after commit");
  });
  await expect(first.save(lost)).rejects.toThrow("Reply lost");
  first.update({ body: "Do not replace an uncertain saved intent" });
  expect(first.value.body).toBe("Exact owner body");
  const reopened = new AssistantNoteDraft(null, disk, () => "never-used", "host-original");
  const retry = vi.fn(async (): Promise<any> => ({ note: note() }));
  expect(await reopened.save(retry)).toEqual(note());
  expect(retry).toHaveBeenCalledExactlyOnceWith(
    { op: "notes.get", id: "stable-note" },
    "host-original",
  );
  reopened.clear();
  expect(
    new AssistantNoteDraft(null, disk, () => "next-note", "host-original").value,
  ).toMatchObject({ id: "next-note", title: "", body: "" });
});
it("never overwrites an owner edit under the retained create identity", async () => {
  const draft = new AssistantNoteDraft(null, storage(), () => "stable-note", "host-original");
  draft.update({ title: "Owner note", body: "Exact owner body" });
  await expect(
    draft.save(async () => {
      throw new Error("lost");
    }),
  ).rejects.toThrow();
  const request = vi.fn(async (): Promise<any> => ({
    note: note({ body: "Owner edited the saved note", updatedAt: 99 }),
  }));
  await expect(draft.save(request)).rejects.toThrow("changed on the computer");
  expect(request).toHaveBeenCalledTimes(1);
  expect(draft.value.id).toBe("stable-note");
});
it("parks a missing uncertain note without resurrecting an owner-deleted record", async () => {
  const draft = new AssistantNoteDraft(null, storage(), () => "stable-note", "host-original");
  draft.update({ title: "Owner note", body: "Exact owner body" });
  await expect(
    draft.save(async () => {
      throw new Error("not admitted");
    }),
  ).rejects.toThrow();
  const request = vi.fn(async (input: any): Promise<any> =>
    input.op === "notes.get" ? { note: null } : { note: note({ id: "wrong-note" }) },
  );
  await expect(draft.save(request)).rejects.toThrow("no longer available");
  expect(request).toHaveBeenCalledExactlyOnceWith(
    { op: "notes.get", id: "stable-note" },
    "host-original",
  );
  expect(draft.value.intent).toMatchObject({
    id: "stable-note",
    expectedUpdatedAt: 0,
    body: "Exact owner body",
  });
});
it("keeps existing optimistic edit version and allows retry only while its baseline remains current", async () => {
  const disk = storage(),
    draft = new AssistantNoteDraft(note(), disk, () => "unused", "host-original");
  draft.update({ body: "Revised body" });
  await expect(
    draft.save(async () => {
      throw new Error("lost before commit");
    }),
  ).rejects.toThrow();
  const reopened = new AssistantNoteDraft(
    note({ updatedAt: 7 }),
    disk,
    () => "unused",
    "host-original",
  );
  const request = vi.fn(async (input: any): Promise<any> =>
    input.op === "notes.get"
      ? { note: note() }
      : { note: note({ body: "Revised body", updatedAt: 8 }) },
  );
  expect(await reopened.save(request)).toMatchObject({ body: "Revised body" });
  expect(request.mock.calls[1][0]).toMatchObject({ expectedUpdatedAt: 2 });
});
it("does not dispatch when durable intent cannot be persisted and deduplicates pending saves", async () => {
  const disk = storage();
  disk.setItem = () => {
    throw new Error("quota");
  };
  const failed = new AssistantNoteDraft(null, disk, () => "stable-note", "host-original");
  failed.update({ title: "Owner note" });
  const empty = vi.fn();
  await expect(failed.save(empty)).rejects.toThrow("could not be saved on this device");
  expect(empty).not.toHaveBeenCalled();
  const draft = new AssistantNoteDraft(null, storage(), () => "stable-note", "host-original");
  draft.update({ title: "Owner note", body: "Exact owner body" });
  let resolve!: (value: any) => void;
  const request = vi.fn(
      () =>
        new Promise<any>((done) => {
          resolve = done;
        }),
    ),
    first = draft.save(request);
  expect(draft.save(request)).toBe(first);
  resolve({ note: note() });
  await first;
  expect(request).toHaveBeenCalledTimes(1);
});
it("compares actual native title/newline normalization without losing Unicode code points", async () => {
  const draft = new AssistantNoteDraft(null, storage(), () => "stable-note", "host-original");
  draft.update({ title: ` ${"😀".repeat(205)} `, body: "first\r\nsecond\rthird" });
  expect(
    await draft.save(async () => ({
      note: note({ title: "😀".repeat(200), body: "first\nsecond\nthird" }),
    })),
  ).toMatchObject({ body: "first\nsecond\nthird" });
});
it("keeps the original Host for a lost reply even when an identical note is displayed on another Host", async () => {
  const disk = storage();
  const first = new AssistantNoteDraft(note(), disk, () => "unused", "host-original");
  first.update({ body: "Revised" });
  await expect(
    first.save(async () => {
      throw new Error("lost");
    }),
  ).rejects.toThrow("lost");
  const reopened = new AssistantNoteDraft(note(), disk, () => "unused", "replacement");
  const request = vi.fn(async (_input: any, environment?: string): Promise<any> => {
    if (environment !== "replacement") throw new Error("Host changed");
    return { note: note({ body: "Revised" }) };
  });
  await expect(reopened.save(request)).rejects.toThrow("Host changed");
  expect(request.mock.calls).toEqual([[{ op: "notes.get", id: note().id }, "host-original"]]);
});
it("parks legacy attempted identities that have no captured Host without recapturing or writing", async () => {
  const disk = storage();
  const intent = {
    id: "stable-note",
    title: "Owner note",
    body: "Exact owner body",
    expectedUpdatedAt: 0,
  };
  disk.setItem(
    "bycoda.assistant.note-draft:new:record",
    JSON.stringify({ ...intent, version: 1, intent }),
  );
  const reopened = new AssistantNoteDraft(null, disk, () => "new-id", "replacement"),
    request = vi.fn();
  await expect(reopened.save(request)).rejects.toThrow("original Host");
  expect(request).not.toHaveBeenCalled();
  expect(reopened.value.id).toBe("stable-note");
});
