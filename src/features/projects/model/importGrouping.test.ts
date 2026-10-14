import { describe, expect, it } from "vitest";
import { pathKey } from "../../../shared/lib/paths";
import { proposeProjectGroups } from "./importGrouping";

const none = new Set<string>();

describe("proposeProjectGroups", () => {
  it("groups projects by the folder they sit in", () => {
    const groups = proposeProjectGroups({
      grouped: none,
      paths: [
        "G:/Projects/Acme/jira",
        "G:/Projects/Acme/db-ai",
        "G:/Projects/work/web",
        "G:/Projects/work/api",
        "G:/shop/mobile",
        "G:/shop/admin",
      ],
    });
    expect(groups.map((group) => [group.name, group.paths])).toEqual([
      ["Acme", ["G:/Projects/Acme/db-ai", "G:/Projects/Acme/jira"]],
      ["shop", ["G:/shop/admin", "G:/shop/mobile"]],
      ["work", ["G:/Projects/work/api", "G:/Projects/work/web"]],
    ]);
  });

  it("never makes a group for a lone project", () => {
    expect(
      proposeProjectGroups({
        grouped: none,
        paths: ["G:/Projects/solo/app", "G:/Projects/other/app"],
      }),
    ).toEqual([]);
  });

  it("lets a lone project join a group the user already has", () => {
    const groups = proposeProjectGroups({
      grouped: none,
      existingGroupNames: ["acme"],
      paths: ["G:/Projects/Acme/jira"],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Acme");
  });

  it("leaves projects the user already grouped alone, and does not count them", () => {
    const groups = proposeProjectGroups({
      grouped: new Set([pathKey("G:/Projects/Acme/jira")]),
      paths: ["G:/Projects/Acme/jira", "G:/Projects/Acme/db-ai"],
    });
    expect(groups).toEqual([]);
  });

  it("matches folders case-insensitively and counts a project once", () => {
    const groups = proposeProjectGroups({
      grouped: none,
      paths: ["g:/Projects/work/api", "G:/Projects/work/web", "G:/projects/WORK/api"],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].paths).toEqual(["g:/Projects/work/api", "G:/Projects/work/web"]);
  });

  it("ignores drive roots and the home folder", () => {
    expect(
      proposeProjectGroups({
        grouped: none,
        paths: ["G:/a", "G:/b", "C:/Users/dev/x", "C:/Users/dev/y"],
      }),
    ).toEqual([]);
  });

  it("keeps same-named folders in different places apart", () => {
    const groups = proposeProjectGroups({
      grouped: none,
      paths: ["G:/one/src/a", "G:/one/src/b", "G:/two/src/c", "G:/two/src/d"],
    });
    expect(groups.map((group) => group.name)).toEqual(["src (G:/one)", "src (G:/two)"]);
  });
});
