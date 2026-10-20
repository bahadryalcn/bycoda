import { describe, expect, it } from "vitest";
import {
  assertSkillInvocationsEnabled,
  parseSkillPolicy,
  skillDisabled,
  withSkillPolicy,
  skillInvocationFlags,
} from "./skillPolicy";

it("distinguishes manual-only and automatic-only skills without reading flags from body copy", () => {
  expect(
    skillInvocationFlags("---\ndisable-model-invocation: true\nuser-invocable: false\n---\nbody"),
  ).toEqual({ modelInvocable: false, userInvocable: false });
  expect(
    skillInvocationFlags(
      "---\ndescription: |\n  disable-model-invocation: true\n---\nuser-invocable: false",
    ),
  ).toEqual({});
});

const policy = { disabledNames: ["good-css"], disabledPaths: ["C:/Skills/good-css/SKILL.md"] };

it("blocks same-name copies and normalizes Windows path aliases without folding Unix case", () => {
  expect(skillDisabled(policy, { name: "good-css", path: "/other/source/SKILL.md" })).toBe(true);
  expect(
    skillDisabled(policy, { name: "alias", path: "\\\\?\\c:\\skills\\GOOD-CSS\\skill.md" }),
  ).toBe(true);
  expect(
    skillDisabled(
      { disabledNames: [], disabledPaths: ["/Home/skill.md"] },
      { name: "alias", path: "/home/skill.md" },
    ),
  ).toBe(false);
});

it("blocks explicit slash, dollar and Pi invocations but allows quoted examples", () => {
  for (const text of ["/good-css fix", "$good-css fix", "/skill:good-css fix"])
    expect(() => assertSkillInvocationsEnabled(text, policy)).toThrow("disabled");
  for (const text of ["`$good-css`", "> /good-css", "```\n/good-css\n```", "inspect good-css"])
    expect(() => assertSkillInvocationsEnabled(text, policy)).not.toThrow();
});

describe.each([
  "codex",
  "claude",
  "cursor",
  "grok",
  "opencode",
  "pi",
  "omp",
  "fx",
  "hermes",
  "antigravity",
  "gemini",
  "acp",
])("%s owner restrictions", (harness) => {
  it("carries current restrictions and preserves native command position", () => {
    const input = withSkillPolicy(
      harness,
      { text: "/compact", runtimeInstructions: "existing guidance" },
      policy,
    );
    expect(input.text.startsWith("/compact")).toBe(true);
    if (harness === "codex") expect(input.runtimeInstructions).toContain("same-name copies");
    else expect(input.text).toBe("/compact");
    expect(input.skillPolicy).toEqual(policy);
    const enabled = withSkillPolicy(
      harness,
      { text: "continue" },
      { disabledNames: [], disabledPaths: [] },
    );
    expect(harness === "codex" ? enabled.runtimeInstructions : enabled.text).toContain(
      "replaces older",
    );
  });
});

it("rejects corrupt or permission-pattern names instead of enabling everything", () => {
  for (const value of [
    null,
    {},
    { disabledNames: ["*"], disabledPaths: [] },
    { disabledNames: [], disabledPaths: [42] },
  ])
    expect(() => parseSkillPolicy(value)).toThrow();
});
