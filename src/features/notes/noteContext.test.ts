import { expect, it } from "vitest";
import { composeNoteContext, noteContextMeta, readNoteContext } from "./noteContext";
const card = { id: "note-one", slug: "one", title: " Review ", body: "  Reviewed snapshot  ", sourceCwd: "/project" };
it("keeps note display metadata separate from the exact bounded prompt snapshot", () => {
  expect(composeNoteContext(readNoteContext(card), "  Check this  ")).toBe('Check this\n\n---\nReferenced note "Review":\n\nReviewed snapshot');
  expect(composeNoteContext(card, "")).toContain("Use this note.");
  expect(noteContextMeta(card)).toEqual({ id: "note-one", slug: "one", title: " Review ", sourceCwd: "/project" });
  expect(composeNoteContext(undefined, " raw ")).toBe("raw");
  expect(readNoteContext({ ...card, title: "🙂".repeat(200) }).title).toBe("🙂".repeat(200));
  expect(() => readNoteContext({ ...card, title: "🙂".repeat(201) })).toThrow();
});
it("refuses malformed, blank, excessive and unexpected context fields", () => {
  for (const value of [null, { ...card, body: " " }, { ...card, body: "x".repeat(64_001) }, { ...card, body: "x\0y" }, { ...card, sourceCwd: "x".repeat(4097) }, { ...card, auth: "fixture" }])
    expect(() => readNoteContext(value)).toThrow(/note context/);
});
