import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { RECOMMENDED_SKILLS } from "./recommendedSkills";

describe("recommended skill sources", () => {
  it("uses unique logical names and complete upstream directory sources", () => {
    const names = new Set<string>();
    for (const skill of RECOMMENDED_SKILLS) {
      expect(skill.id).toBe(skill.name);
      expect(skill.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(names.has(skill.name)).toBe(false);
      names.add(skill.name);
      const repository = new URL(skill.repository);
      expect(repository.protocol).toBe("https:");
      expect(repository.hostname).toBe("github.com");
      expect(repository.pathname).toMatch(/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
      expect(repository.search + repository.hash).toBe("");
      expect(skill.skillPath).not.toMatch(/(^|\/)\.{1,2}(\/|$)|\\|SKILL\.md$/);
      expect(skill.sourceUrl).toBe(`${skill.repository}/tree/${skill.ref}/${skill.skillPath}`);
      expect(skill.description.trim().length).toBeGreaterThan(20);
    }
  });

  it("uses corrected publisher paths instead of stale local installation paths", () => {
    const byName = new Map(RECOMMENDED_SKILLS.map((skill) => [skill.name, skill]));
    expect(byName.get("image-to-code")?.repository).toBe(
      "https://github.com/Leonxlnx/imagegen-skills",
    );
    expect(byName.get("image-to-code")?.skillPath).toBe("skills/image-to-code");
    expect(byName.get("impeccable")?.skillPath).toBe(".agents/skills/impeccable");
    expect(byName.get("ui-ux-pro-max")?.skillPath).toBe(".claude/skills/ui-ux-pro-max");
    expect(byName.get("vercel-react-best-practices")?.skillPath).toBe(
      "skills/react-best-practices",
    );
  });

  it("exposes runtime prerequisites without treating installation as capability", () => {
    for (const name of ["impeccable", "ui-ux-pro-max", "agent-desktop", "image-to-code"]) {
      expect(RECOMMENDED_SKILLS.find((skill) => skill.name === name)?.note).toBeTruthy();
    }
  });

  it("provides every catalog description, category and prerequisite in all app locales", () => {
    const keys = RECOMMENDED_SKILLS.flatMap((skill) => [
      skill.description,
      skill.category,
      ...(skill.note ? [skill.note] : []),
    ]);
    for (const locale of ["en", "tr", "de", "fr", "es", "pt", "zh-CN", "ja"]) {
      const catalog = JSON.parse(
        readFileSync(
          new URL(`../../../shared/i18n/locales/${locale}.json`, import.meta.url),
          "utf8",
        ),
      ) as Record<string, string>;
      for (const key of keys) {
        expect(catalog[key], `${locale}: ${key}`).toBeTruthy();
      }
    }
  });
});
