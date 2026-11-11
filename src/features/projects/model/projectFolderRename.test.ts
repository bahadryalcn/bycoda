import { expect, it } from "vitest";
import { folderRenameError, folderRenameErrorWith } from "./projectFolderRename";

it("folderRenameErrorWith matches folderRenameError and uses the given translator", () => {
  for (const name of ["ok", "", " pad", "a/b", "con", "trail."]) {
    expect(folderRenameErrorWith(name, (key) => key)).toBe(folderRenameError(name));
  }
  expect(folderRenameErrorWith("a/b", () => "X")).toBe("X");
  expect(folderRenameErrorWith("fine", () => "X")).toBeNull();
});
