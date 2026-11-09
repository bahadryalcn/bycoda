import { describe, expect, it } from "vitest";
import { parseGitPanelSections } from "./panelSections";

describe("parseGitPanelSections", () => {
  it("shows every section unless explicitly hidden", () => {
    expect(parseGitPanelSections(null)).toEqual({ stashes: true, graph: true });
    expect(parseGitPanelSections("not json")).toEqual({ stashes: true, graph: true });
    expect(parseGitPanelSections("[]")).toEqual({ stashes: true, graph: true });
    expect(parseGitPanelSections('{"graph":"no"}')).toEqual({ stashes: true, graph: true });
  });

  it("keeps a hidden section hidden", () => {
    expect(parseGitPanelSections('{"stashes":false}')).toEqual({ stashes: false, graph: true });
    expect(parseGitPanelSections('{"graph":false,"stashes":true}')).toEqual({
      stashes: true,
      graph: false,
    });
  });
});
