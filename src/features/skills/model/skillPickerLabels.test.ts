import { describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/i18n", () => ({ t: (message: string) => `T:${message}` }));

import { mergeCliCommands } from "./cliCommands";
import { skillPickerDescription, skillScopeLabel } from "./skillPickerLabels";
import type { Skill } from "./skills";

const none = new Set<string>();

describe("skill picker labels", () => {
  it("translates built-in CLI descriptions and the built-in origin", () => {
    const [context] = mergeCliCommands({
      harness: "claude",
      reported: [],
      disk: [],
      taken: none,
    }).filter((skill) => skill.kind === "native" && skill.invocation === "context");

    expect(context).toBeDefined();
    expect(skillPickerDescription(context!)).toBe("T:Show current context usage");
    expect(skillScopeLabel(context!)).toBe("claude · T:Built-in");
  });

  it("translates the Codex goal description", () => {
    const [goal] = mergeCliCommands({ harness: "codex", reported: [], disk: [], taken: none });

    expect(skillPickerDescription(goal!)).toBe(
      "T:Set a persistent Codex goal, show its progress, pause or clear it",
    );
  });

  it("keeps provider-reported descriptions as written and labels their origin", () => {
    const [review] = mergeCliCommands({
      harness: "claude",
      reported: [{ name: "review", kind: "command", description: "Review the diff" }],
      disk: [],
      taken: none,
    }).filter((skill) => skill.kind === "native" && skill.invocation === "review");

    expect(review).toBeDefined();
    expect(skillPickerDescription(review!)).toBe("Review the diff");
    expect(skillScopeLabel(review!)).toBe("claude · T:Session");
  });

  it("localizes the scope labels of template and file skills", () => {
    const template = { kind: "template", name: "t", description: "", invocation: "t" } as Skill;
    const personal = {
      kind: "file",
      scope: "user",
      source: "agents",
      name: "p",
      description: "",
      invocation: "p",
    } as Skill;
    const project = { ...personal, scope: "project" } as Skill;

    expect(skillScopeLabel(template)).toBe("T:Templates");
    expect(skillScopeLabel(personal)).toBe("T:Personal");
    expect(skillScopeLabel(project)).toBe("T:Project");
  });
});
