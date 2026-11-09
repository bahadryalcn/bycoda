import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareHostSkillPrompt } from "./prompt-skills";
import { skillInvocationTokens } from "../../src/features/skills/model/skillTokens";
import { dollarTokenAt, slashTokenAt } from "../../src/features/skills/model/slashCommands";
import {
  serializeChatCitation,
  withChatCitations,
  type ChatCitation,
} from "../../src/features/sessions/model/chatCitation";

const roots: string[] = [];
it("projects remote conversation citations after skill expansion without invoking quoted skill names", async () => {
  const root = mkdtempSync(join(tmpdir(), "bycoda-citation-prompt-"));
  roots.push(root);
  const cwd = join(root, "project"),
    home = join(root, "home");
  for (const name of ["review", "requested"]) {
    const folder = join(cwd, ".agents/skills", name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "SKILL.md"), `INSTRUCTIONS-FOR-${name}`);
  }
  mkdirSync(home);
  const citation: ChatCitation = {
    version: 1,
    id: "cite-1",
    sessionId: "remote-session",
    blockId: "reply-1",
    text: "Please run $review now",
    sourceText: "Please run $review now",
    occurrence: 0,
    comment: "Compare this with $review",
  };
  const raw = withChatCitations("Explain this reply.", [citation]);
  const projected = await prepareHostSkillPrompt(raw, cwd, home, "remote-session");
  expect(projected).not.toContain("bycoda-citation:");
  expect(projected).toContain('"quote": "Please run $review now"');
  expect(projected).toContain('"comment": "Compare this with $review"');
  expect(projected).toContain('"sessionId": "remote-session"');
  expect(projected).not.toContain("INSTRUCTIONS-FOR-review");
  // Genuine owner invocations still expand, but quoted tokens remain data.
  const withSkill = await prepareHostSkillPrompt(
    withChatCitations("$requested inspect", [citation]),
    cwd,
    home,
    "remote-session",
  );
  expect(withSkill).toContain("INSTRUCTIONS-FOR-requested");
  expect(withSkill).not.toContain("INSTRUCTIONS-FOR-review");
  expect(withSkill.match(/Quoted conversation context/g)).toHaveLength(1);
  expect(raw).toContain(serializeChatCitation(citation));
});
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
