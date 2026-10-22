import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareHostSkillPrompt } from "./prompt-skills";
import { skillInvocationTokens } from "../src/features/skills/model/skillTokens";
import { dollarTokenAt, slashTokenAt } from "../src/features/skills/model/slashCommands";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.each(["$", "/"])(
  "keeps %s skill examples literal across host expansion and desktop tokens",
  async (trigger) => {
    const root = mkdtempSync(join(tmpdir(), "bycoda-prompt-skills-"));
    roots.push(root);
    const cwd = join(root, "project"),
      home = join(root, "home");
    const folder = join(cwd, ".agents/skills/review");
    mkdirSync(folder, { recursive: true });
    mkdirSync(home);
    writeFileSync(join(folder, "SKILL.md"), "RECOGNIZABLE SKILL INSTRUCTIONS");
    const token = `${trigger}review`;
    const literal = [
      `Explain:\n\x60\x60\x60text\n${token}\n\x60\x60\x60`,
      `~~~~text\n${token}\n~~~~`,
      `\x60\x60\x60\x60text\n\x60\x60\x60\n${token}\n\x60\x60\x60\x60`,
      `Example \x60 ${token} \x60 here`,
      `Example \x60\x60 ${token} \x60 inside \x60\x60 here`,
      `Example \x60\x60 spanning\n${token}\n\x60\x60 here`,
      `> ${token}\n   > ${token}`,
    ];
    for (const text of literal) {
      expect(await prepareHostSkillPrompt(text, cwd, home)).toBe(text);
      expect(skillInvocationTokens(text)).toEqual([]);
      const at = text.indexOf(token) + token.length;
      expect(trigger === "$" ? dollarTokenAt(text, at) : slashTokenAt(text, at)).toBeNull();
    }
    const prose = `Please use ${token} now`;
    expect(await prepareHostSkillPrompt(prose, cwd, home)).toContain(
      "RECOGNIZABLE SKILL INSTRUCTIONS",
    );
    expect(skillInvocationTokens(prose).map((token) => token.name)).toEqual(["review"]);
    const afterFence = `~~~text\n${token}\n~~~\n${token}`;
    expect(skillInvocationTokens(afterFence)).toHaveLength(1);
    expect(await prepareHostSkillPrompt(afterFence, cwd, home)).toContain(
      "RECOGNIZABLE SKILL INSTRUCTIONS",
    );
  },
);
