import { expect, it } from "vitest";
import { join } from "node:path";
import { TerminalWorkspaceIndex } from "./workspace-index";

it("tracks only live terminal paths under each workspace", () => {
  const index = new TerminalWorkspaceIndex();
  const root = join(process.cwd(), "workspace");
  const child = join(root, "nested");
  const sibling = `${root}-other`;
  index.add("a", child);
  index.add("b", sibling);
  expect(index.ids(root)).toEqual(["a"]);
  index.delete("a", child);
  expect(index.ids(root)).toEqual([]);
  expect(index.ids(sibling)).toEqual(["b"]);
});
