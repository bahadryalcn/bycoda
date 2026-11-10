import { describe, expect, it } from "vitest";
import {
  crewHostToolChoices,
  mergeNamedChoices,
  parseCrewHostTools,
  withSelectedChoices,
} from "./crewToolCatalog";

const labels = { all: (count: number) => `all ${count}`, reads: "reads", writes: "writes" };

describe("parseCrewHostTools", () => {
  it("returns nothing for an older Host or a malformed answer", () => {
    expect(parseCrewHostTools({ version: 1 })).toEqual([]);
    expect(parseCrewHostTools(null)).toEqual([]);
    expect(parseCrewHostTools({ hostTools: "files.read" })).toEqual([]);
  });

  it("keeps valid rows once and drops invalid ones", () => {
    expect(
      parseCrewHostTools({
        hostTools: [
          { action: "files.read", write: false, summary: "Read a file." },
          { action: "files.read", write: true, summary: "again" },
          { action: "Not valid!", write: true, summary: "" },
          { action: "files.write", write: true },
          null,
        ],
      }),
    ).toEqual([
      { action: "files.read", write: false, summary: "Read a file." },
      { action: "files.write", write: true, summary: "" },
    ]);
  });
});

describe("crewHostToolChoices", () => {
  it("puts a whole-group row ahead of a group with several tools", () => {
    const choices = crewHostToolChoices(
      [
        { action: "files.read", write: false, summary: "Read a file." },
        { action: "files.write", write: true, summary: "" },
        { action: "resources.read", write: false, summary: "Usage." },
      ],
      labels,
    );
    expect(choices).toEqual([
      { value: "files", description: "all 2", group: "files" },
      { value: "files.read", description: "Read a file.", meta: "reads", group: "files" },
      { value: "files.write", description: undefined, meta: "writes", group: "files" },
      { value: "resources.read", description: "Usage.", meta: "reads", group: "resources" },
    ]);
  });
});

describe("named choices", () => {
  it("merges the same name across providers and sorts", () => {
    expect(
      mergeNamedChoices([
        { value: "github", meta: "Codex" },
        { value: " figma ", meta: "Claude Code" },
        { value: "github", meta: "Claude Code" },
        { value: "github", meta: "Codex" },
        { value: "  " },
      ]),
    ).toEqual([
      { value: "figma", meta: "Claude Code" },
      { value: "github", meta: "Codex, Claude Code" },
    ]);
  });

  it("keeps a saved name the list does not know", () => {
    expect(withSelectedChoices([{ value: "a" }], ["a", "gone"])).toEqual([
      { value: "a" },
      { value: "gone" },
    ]);
  });
});
