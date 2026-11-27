import { expect, it } from "vitest";
import { checkoutBlockedFiles } from "./checkoutBlockedFiles";

it("lists the tracked files git says would be overwritten", () => {
  expect(
    checkoutBlockedFiles(
      "error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/a.ts\n\tdocs/b md.txt\nPlease commit your changes or stash them before you switch branches.\nAborting",
    ),
  ).toEqual(["src/a.ts", "docs/b md.txt"]);
});

it("lists untracked files and both sections of one message", () => {
  expect(
    checkoutBlockedFiles(
      "error: Your local changes to the following files would be overwritten by checkout:\r\n\ta.txt\r\nerror: The following untracked working tree files would be overwritten by checkout:\r\n\tnew.txt\r\n\ta.txt\r\nPlease move or remove them before you switch branches.",
    ),
  ).toEqual(["a.txt", "new.txt"]);
});

it("returns nothing when the message names no files", () => {
  expect(
    checkoutBlockedFiles("Your local changes would be overwritten. Commit or stash them first."),
  ).toEqual([]);
});
