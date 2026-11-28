import { expect, it } from "vitest";
import { separateSections } from "./useProjectMenu";
import type { TabGroupMenuExtraItem } from "../../features/workspace/ui/TabGroupMenu";

const item = (id: string): TabGroupMenuExtraItem => ({
  id,
  label: id,
  icon: (() => null) as never,
});

it("keeps the group menu order and puts one separator between non-empty sections", () => {
  const items = separateSections([
    [item("add-project-to-group"), item("workspace-parent"), item("workspace")],
    [item("git-overview"), item("fetch-all")],
    [item("order"), item("kind"), item("lock-group"), item("privacy")],
    [item("delete")],
  ]);
  expect(items.map((entry) => entry.id)).toEqual([
    "add-project-to-group",
    "workspace-parent",
    "workspace",
    "git-overview",
    "fetch-all",
    "order",
    "kind",
    "lock-group",
    "privacy",
    "delete",
  ]);
  expect(items.filter((entry) => entry.sepBefore).map((entry) => entry.id)).toEqual([
    "git-overview",
    "order",
    "delete",
  ]);
});

it("never leads with a separator when early sections are empty (a locked group)", () => {
  const items = separateSections([[], [], [item("order"), item("privacy")], []]);
  expect(items.map((entry) => entry.sepBefore)).toEqual([undefined, undefined]);
});
