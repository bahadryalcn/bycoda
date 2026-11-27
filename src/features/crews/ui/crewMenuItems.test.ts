import { describe, expect, it } from "vitest";
import type { CrewDefinition } from "../model/crew";
import { crewMenuDialog, crewMenuItems } from "./crewMenuItems";

const crew = (projectId?: string) => ({ id: "c1", name: "Core", projectId }) as CrewDefinition;

describe("crew menu", () => {
  it("maps picks to the dialog they open", () => {
    expect(crewMenuDialog("edit", crew())).toEqual({ kind: "edit", crewId: "c1" });
    expect(crewMenuDialog("delete", crew())).toEqual({ kind: "delete", crewId: "c1" });
    expect(crewMenuDialog("duplicate", crew("p1"))).toEqual({
      kind: "edit",
      copyOf: { crewId: "c1", scope: "project" },
    });
    expect(crewMenuDialog("scope", crew("p1"))).toEqual({
      kind: "edit",
      copyOf: { crewId: "c1", scope: "global" },
    });
    expect(crewMenuDialog("scope", crew())).toEqual({
      kind: "edit",
      copyOf: { crewId: "c1", scope: "project" },
    });
    expect(crewMenuDialog("open", crew())).toBeNull();
    // Work and new work are not menu items: the Work tab and the card own them.
    expect(crewMenuDialog("work", crew())).toBeNull();
    expect(crewMenuDialog("start", crew())).toBeNull();
  });

  it("lists only the crew's own operations", () => {
    const ids = crewMenuItems(crew(), { canOpenCoordinator: false, deleteSupported: true }).flatMap(
      (item) => (item.kind === "item" ? [item.id] : []),
    );
    expect(ids).toEqual(["edit", "duplicate", "scope", "delete"]);
  });

  it("offers delete only when the host supports it", () => {
    const ids = (deleteSupported: boolean) =>
      crewMenuItems(crew(), { canOpenCoordinator: false, deleteSupported }).flatMap((item) =>
        item.kind === "item" ? [item.id] : [],
      );
    expect(ids(true)).toContain("delete");
    expect(ids(false)).not.toContain("delete");
    expect(ids(false)).not.toContain("open");
  });
});
