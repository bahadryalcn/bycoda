import { describe, expect, it } from "vitest";
import type { GitChangedFile } from "../../../platform/tauri/fs";
import { splitSubmodulePointers } from "./submodulePointers";

const file = (relative: string): GitChangedFile => ({
  path: `/repo/${relative}`,
  relative,
  status: "modified",
  additions: 1,
  deletions: 1,
  staged: true,
  unstaged: false,
});

describe("splitSubmodulePointers", () => {
  it("moves only exact gitlink paths of listed submodules", () => {
    const files = [file("child"), file("child/inner.txt"), file("children"), file("nested/a")];
    const [listed, pointers] = splitSubmodulePointers(files, ["child", "nested\\a"]);
    expect(pointers.map((entry) => entry.relative)).toEqual(["child", "nested/a"]);
    expect(listed.map((entry) => entry.relative)).toEqual(["child/inner.txt", "children"]);
  });

  it("keeps every row when no submodule is listed", () => {
    const files = [file("child")];
    expect(splitSubmodulePointers(files)).toEqual([files, []]);
  });
});
