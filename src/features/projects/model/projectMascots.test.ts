import { describe, expect, it } from "vitest";
import {
  MASCOT_GRID,
  PROJECT_MASCOTS,
  normalizeProjectMascotName,
  projectMascot,
  filterProjectMascots,
  DEFAULT_PROJECT_MASCOT_NAMES,
} from "./projectMascots";

describe("projectMascots", () => {
  it("provides distinct semantic code-art silhouettes on a shared canvas", () => {
    expect(MASCOT_GRID).toBe(24);
    expect(PROJECT_MASCOTS).toHaveLength(32);
    expect(new Set(PROJECT_MASCOTS.map((mascot) => mascot.restPath)).size).toBe(32);
    expect(new Set(PROJECT_MASCOTS.map((mascot) => mascot.label)).size).toBe(32);
    expect(new Set(PROJECT_MASCOTS.map((mascot) => mascot.color)).size).toBe(32);
    for (const mascot of PROJECT_MASCOTS) {
      expect(mascot.restPath).not.toBe("");
      expect(mascot.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(mascot.highlight).toMatch(/^#[0-9a-f]{6}$/i);
      expect(mascot.talkPath).not.toBe("");
      expect(mascot.talkPath).toBe(mascot.restPath);
    }
  });

  it("picks the same mascot for the same project", () => {
    expect(projectMascot("~/code/bycoda")).toBe(projectMascot("~/code/bycoda"));
  });

  it("honors an explicit pick and ignores unknown names", () => {
    expect(projectMascot("alpha", "link").name).toBe("link");
    expect(projectMascot("alpha", "ghost").name).toBe("orbit");
    expect(projectMascot("alpha", "cat").name).toBe("link");
    expect(projectMascot("alpha", "nope").name).toBe(projectMascot("alpha").name);
    expect(projectMascot("alpha", null).name).toBe(projectMascot("alpha").name);
  });

  it("spreads projects across the roster", () => {
    const names = new Set(
      ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"].map(
        (project) => projectMascot(project).name,
      ),
    );
    expect(names.size).toBeGreaterThan(3);
  });

  it("migrates persisted character picks and rejects unrelated names", () => {
    expect(normalizeProjectMascotName("cat")).toBe("link");
    expect(normalizeProjectMascotName("weave")).toBe("weave");
    expect(normalizeProjectMascotName("toString")).toBeNull();
    expect(normalizeProjectMascotName(null)).toBeNull();
  });

  it("retains the original automatic assignments as the selectable roster grows", () => {
    for (const path of ["alpha", "beta", "private", "G:/Projects/web", "", "bycoda"]) {
      let hash = 0;
      for (let i = 0; i < path.length; i++) hash = (hash * 131 + path.charCodeAt(i)) >>> 0;
      expect(projectMascot(path).name).toBe(DEFAULT_PROJECT_MASCOT_NAMES[hash % 8]);
    }
    expect(projectMascot("alpha", "shield").name).toBe("shield");
    expect(projectMascot("alpha", "launch").name).toBe("launch");
    expect(normalizeProjectMascotName("rocket")).toBe("compass");
  });

  it("searches Turkish and English aliases without requiring accents", () => {
    expect(filterProjectMascots("cuzdan").map((icon) => icon.name)).toEqual(["wallet"]);
    expect(filterProjectMascots("GÜVENLİK").map((icon) => icon.name)).toEqual(["shield"]);
    expect(filterProjectMascots("yapay zeka").map((icon) => icon.name)).toEqual(["braid"]);
    expect(filterProjectMascots("payment", "Services").map((icon) => icon.name)).toEqual([
      "wallet",
    ]);
    expect(filterProjectMascots("payment", "Creative")).toEqual([]);
    expect(filterProjectMascots("definitely missing")).toEqual([]);
    expect(filterProjectMascots("  ")).toHaveLength(32);
  });
});
