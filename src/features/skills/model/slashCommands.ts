import { isSpace } from "../../../shared/lib/text";
import { clamp } from "../../../shared/lib/numbers";
import { fuzzyMatch, prepareFuzzyQuery, type PreparedFuzzyQuery } from "../../../shared/lib/fuzzy";
import { isSkillInvocationPosition } from "./skillTokens";
import { isSkillGroupPickerItem } from "./skillGroupPickerItem";
import type { Skill } from "./skills";

// Keep picker helpers independent of skill discovery for the floating composer.
export type SlashToken = {
  start: number;
  end: number;
  query: string;
  /** `$` for a Codex skill token; a plain slash token leaves it unset. */
  trigger?: "$";
};

const MAX_PICKER = 50;

export function rankSkills(skills: Skill[], query: string, limit = MAX_PICKER): Skill[] {
  const needle = query.trim().toLowerCase();
  const compareNames = (a: Skill, b: Skill) => a.name.localeCompare(b.name);
  let ranked: Skill[];

  if (!needle) {
    ranked = [...skills].sort((a, b) => scopeRank(a) - scopeRank(b) || compareNames(a, b));
    // Keep available groups together between commands and saved templates when browsing.
    ranked = [
      ...ranked.filter((skill) => skill.kind !== "template"),
      ...ranked.filter(isSkillGroupPickerItem),
      ...ranked.filter((skill) => skill.kind === "template" && !isSkillGroupPickerItem(skill)),
    ];
  } else {
    const slug = needle.replace(/\s+/g, "-");
    const fuzzyQuery = prepareFuzzyQuery(needle);
    ranked = skills
      .flatMap((skill) => {
        const match = scoreSkill(skill, slug, fuzzyQuery);
        return match ? [{ skill, ...match }] : [];
      })
      .sort((a, b) => a.tier - b.tier || b.score - a.score || compareNames(a.skill, b.skill))
      .map(({ skill }) => skill);
  }

  // Groups remain available beyond the normal result limit.
  let remaining = limit;
  return ranked.filter((skill) => {
    if (isSkillGroupPickerItem(skill)) return true;
    if (remaining <= 0) return false;
    remaining -= 1;
    return true;
  });
}

function scoreSkill(skill: Skill, slug: string, fuzzyQuery: PreparedFuzzyQuery) {
  const group = isSkillGroupPickerItem(skill) ? skill : null;
  const names = [
    skill.invocation,
    skill.name,
    ...(skill.kind === "native" ? (skill.aliases ?? []) : []),
  ].map((name) => name.toLowerCase().replace(/\s+/g, "-"));
  // A group can match its own title or command, or a single member's name.
  // Scattered letters across a title or a list of members are too weak to suggest a group.
  const direct = names.reduce((best, name) => {
    if (name === slug) return Math.min(best, 0);
    if (name.startsWith(slug)) return Math.min(best, 2);
    if (name.includes(slug)) return Math.min(best, 4);
    return best;
  }, Infinity);
  if (Number.isFinite(direct)) return { tier: direct + (group ? 1 : 0), score: 0 };

  if (group) {
    return group.members.some((member) => member.toLowerCase().includes(slug))
      ? { tier: 7, score: 0 }
      : null;
  }

  const score = names.reduce(
    (best, name) => Math.max(best, fuzzyMatch(fuzzyQuery, name)?.score ?? -Infinity),
    -Infinity,
  );
  if (Number.isFinite(score)) return { tier: 6, score };

  const description = skill.description.toLowerCase();
  return fuzzyQuery.tokens.every((token) => description.includes(token))
    ? { tier: 8, score: 0 }
    : null;
}

function scopeRank(skill: Skill): number {
  if (skill.kind === "template") return 3;
  if (skill.kind === "builtin") return 0;
  if (skill.kind === "native" || skill.scope === "project") return 1;
  return 2;
}

/** Slash token that contains `cursor`, if the user is typing `/skill`. */
export function slashTokenAt(text: string, cursor: number, native = false): SlashToken | null {
  const i = clamp(cursor, 0, text.length);
  let start = i;
  while (start > 0 && !isSpace(text[start - 1]!)) start -= 1;
  if (text[start] !== "/") return null;
  if (start > 0 && text[start - 1] === ":") return null;
  if (!isSkillInvocationPosition(text, start)) return null;

  let end = start + 1;
  while (end < text.length && !isSpace(text[end]!)) end += 1;

  const typed = text.slice(start + 1, i);
  if (typed.includes("/") || typed.includes("\\")) return null;
  if (native) {
    if (!/^[a-zA-Z0-9_.:-]*$/.test(typed)) return null;
  } else {
    if (/[A-Z]/.test(typed)) return null;
    if (!/^(?:[a-z0-9-]+(?::[a-z0-9-]*)?)?$/.test(typed)) return null;
  }

  return { start, end, query: typed };
}

/**
 * `$skill` token at `cursor`, Codex's way of naming a skill. Only at the start
 * of a word and never in code, so `US$5`, `a$b` and `` `$HOME` `` stay plain.
 */
export function dollarTokenAt(text: string, cursor: number): SlashToken | null {
  const i = clamp(cursor, 0, text.length);
  let start = i;
  while (start > 0 && !isSpace(text[start - 1]!)) start -= 1;
  if (text[start] !== "$") return null;
  const typed = text.slice(start + 1, i);
  if (!/^[A-Za-z0-9_.:-]*$/.test(typed)) return null;
  if (!isSkillInvocationPosition(text, start)) return null;

  let end = start + 1;
  while (end < text.length && !isSpace(text[end]!)) end += 1;
  return { start, end, query: typed, trigger: "$" };
}

export function replaceSlashToken(text: string, token: SlashToken, name: string): string {
  const rest = text.slice(token.end);
  const spacer = rest.startsWith(" ") ? "" : " ";
  return `${text.slice(0, token.start)}${token.trigger ?? "/"}${name}${spacer}${rest}`;
}
