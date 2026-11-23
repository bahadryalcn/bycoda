import { parser } from "@lezer/markdown";
import { expect, it, vi } from "vitest";
import { deleteTokenAtCaret } from "../model/attachmentTokens";
import { snapAttachmentSelection } from "./attachmentSelectionPolicy";

const files = [
  { kind: "image" as const, size: 1 },
  { kind: "file" as const, size: 1 },
];

it("snaps caret and selection around resolved references", () => {
  const text = "a [image1] [file1] z";
  expect(snapAttachmentSelection(text, files, 3, 3, "backward")).toEqual({ start: 2, end: 2 });
  expect(snapAttachmentSelection(text, files, 3, 3, "forward")).toEqual({ start: 10, end: 10 });
  expect(snapAttachmentSelection(text, files, 4, 15)).toEqual({ start: 2, end: 18 });
});

it("leaves unresolved and code references as ordinary text", () => {
  expect(snapAttachmentSelection("[image2]", files, 3, 3)).toEqual({ start: 3, end: 3 });
  expect(snapAttachmentSelection("`[image1]`", files, 4, 4)).toEqual({ start: 4, end: 4 });
});

it("skips Markdown on typing, selection and Backspace outside reference boundaries", () => {
  const text = "Note with `code`.\n\n".repeat(1500) + "[image1] and plain text";
  const end = text.length;
  const parse = vi.spyOn(Object.getPrototypeOf(parser), "parse");
  try {
    expect(snapAttachmentSelection(text, files, end, end)).toEqual({ start: end, end });
    expect(snapAttachmentSelection(text, files, 0, end)).toEqual({ start: 0, end });
    expect(deleteTokenAtCaret(text, end, "back", files)).toBeNull();
    expect(parse.mock.calls.length).toBe(0);
  } finally {
    parse.mockRestore();
  }
});
