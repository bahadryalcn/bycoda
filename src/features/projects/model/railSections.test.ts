// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyShownSectionOrder,
  isDefaultRailSectionOrder,
  loadRailSectionOrder,
  loadRailSectionCollapse,
  toggleRailSectionCollapse,
  moveRailSection,
  normalizeRailSectionOrder,
  resetRailSectionOrder,
  saveRailSectionOrder,
  type RailSectionId,
} from "./railSections";

const DEFAULT: RailSectionId[] = ["last-sessions", "pinned", "groups", "crews", "projects"];

describe("normalizeRailSectionOrder", () => {
  it("falls back to the default order", () => {
    expect(normalizeRailSectionOrder(null)).toEqual(DEFAULT);
    expect(normalizeRailSectionOrder("nope")).toEqual(DEFAULT);
    expect(normalizeRailSectionOrder([])).toEqual(DEFAULT);
  });

  it("keeps a stored order and appends missing sections in default order", () => {
    expect(normalizeRailSectionOrder(["projects", "groups"])).toEqual([
      "crews",
      "projects",
      "groups",
      "last-sessions",
      "pinned",
    ]);
  });

  it("ignores unknown ids, repeats and non-strings", () => {
    expect(normalizeRailSectionOrder(["future", "groups", "groups", 4, "pinned"])).toEqual([
      "groups",
      "pinned",
      "last-sessions",
      "crews",
      "projects",
    ]);
  });

  it("places Crews before Projects in an order saved before it existed", () => {
    expect(normalizeRailSectionOrder(["projects", "last-sessions", "pinned", "groups"])).toEqual([
      "crews",
      "projects",
      "last-sessions",
      "pinned",
      "groups",
    ]);
  });
});

describe("moveRailSection", () => {
  it("moves a section up, down and to the top", () => {
    expect(moveRailSection(DEFAULT, "groups", "up")).toEqual([
      "last-sessions",
      "groups",
      "pinned",
      "crews",
      "projects",
    ]);
    expect(moveRailSection(DEFAULT, "pinned", "down")).toEqual([
      "last-sessions",
      "groups",
      "pinned",
      "crews",
      "projects",
    ]);
    expect(moveRailSection(DEFAULT, "projects", "top")[0]).toBe("projects");
  });

  it("does nothing at the ends", () => {
    expect(moveRailSection(DEFAULT, "last-sessions", "up")).toEqual(DEFAULT);
    expect(moveRailSection(DEFAULT, "projects", "down")).toEqual(DEFAULT);
  });

  it("steps over sections that are not on screen", () => {
    const shown = new Set<RailSectionId>(["last-sessions", "projects"]);
    expect(moveRailSection(DEFAULT, "projects", "up", shown)).toEqual([
      "projects",
      "last-sessions",
      "pinned",
      "groups",
      "crews",
    ]);
    expect(moveRailSection(DEFAULT, "last-sessions", "down", shown)).toEqual([
      "pinned",
      "groups",
      "crews",
      "projects",
      "last-sessions",
    ]);
    expect(moveRailSection(DEFAULT, "projects", "down", shown)).toEqual(DEFAULT);
  });
});

describe("applyShownSectionOrder", () => {
  it("lets hidden sections keep their slot", () => {
    // Pinned and Crews are hidden; dragging Projects above Groups and Last sessions.
    expect(applyShownSectionOrder(DEFAULT, ["projects", "last-sessions", "groups"])).toEqual([
      "projects",
      "pinned",
      "last-sessions",
      "crews",
      "groups",
    ]);
  });

  it("returns the order unchanged for a malformed drag", () => {
    expect(applyShownSectionOrder(DEFAULT, ["groups", "groups"])).toEqual(DEFAULT);
  });
});

describe("saved section order", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips and resets", () => {
    expect(loadRailSectionOrder()).toEqual(DEFAULT);
    saveRailSectionOrder(["groups", "projects", "crews", "pinned", "last-sessions"]);
    expect(loadRailSectionOrder()).toEqual([
      "groups",
      "projects",
      "crews",
      "pinned",
      "last-sessions",
    ]);
    expect(isDefaultRailSectionOrder(loadRailSectionOrder())).toBe(false);
    resetRailSectionOrder();
    expect(loadRailSectionOrder()).toEqual(DEFAULT);
    expect(isDefaultRailSectionOrder(loadRailSectionOrder())).toBe(true);
  });

  it("survives corrupt storage", () => {
    localStorage.setItem("bycoda.projectRailSectionOrder", "{oops");
    expect(loadRailSectionOrder()).toEqual(DEFAULT);
  });
});

describe("saved section collapse", () => {
  beforeEach(() => localStorage.clear());

  it("starts expanded and preserves the other section when toggling", () => {
    expect(loadRailSectionCollapse()).toEqual({ groups: false, crews: false, projects: false });
    toggleRailSectionCollapse("groups");
    toggleRailSectionCollapse("projects");
    expect(loadRailSectionCollapse()).toEqual({ groups: true, crews: false, projects: true });
    toggleRailSectionCollapse("groups");
    expect(loadRailSectionCollapse()).toEqual({ groups: false, crews: false, projects: true });
    toggleRailSectionCollapse("crews");
    expect(loadRailSectionCollapse()).toEqual({ groups: false, crews: true, projects: true });
  });

  it("ignores malformed storage and non-boolean values", () => {
    localStorage.setItem("bycoda.projectRailSectionCollapse", "{oops");
    expect(loadRailSectionCollapse()).toEqual({ groups: false, crews: false, projects: false });
    localStorage.setItem("bycoda.projectRailSectionCollapse", '{"groups":"false","projects":true}');
    expect(loadRailSectionCollapse()).toEqual({ groups: false, crews: false, projects: true });
  });
});
