import { describe, expect, it } from "vitest";
import type { CrewDefinition } from "../model/crew";
import { crewMenuDialog, crewMenuItems } from "./crewMenuItems";

const crew = (projectId?: string) => ({ id: "c1", name: "Core", projectId }) as CrewDefinition;

describe("crew menu", () => {
  it("maps picks to the dialog they open", () => {
    expect(crewMenuDialog("work", crew())).toEqual({ kind: "work", crewId: "c1" });
    expect(crewMenuDialog("members", crew())).toEqual({
      kind: "edit",
      crewId: "c1",
      initialPage: "add",
    });
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
