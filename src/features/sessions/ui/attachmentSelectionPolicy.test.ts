import { expect, it } from "vitest";
import { snapAttachmentSelection } from "./attachmentSelectionPolicy";

const files = [{ kind: "image" as const }, { kind: "file" as const }];

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
