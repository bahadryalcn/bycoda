import { t } from "../../../shared/i18n";
import { useSyncExternalStore } from "react";
import { subscribePreferenceChanges } from "../../../shared/lib/storedSetting";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";

export type SkillGroup = {
  id: string;
  name: string;
  skillNames: string[];
  source: "ai" | "manual";
  updatedAt: number;
};
export type SkillGroupInput = Pick<SkillGroup, "name" | "skillNames"> & {
  source?: SkillGroup["source"];
};
export const SKILL_GROUPS_KEY = "bycoda.skillGroups.v1";
const event = "bycoda:skill-groups";
const empty: SkillGroup[] = [];
let lastRaw: string | null | undefined;
let snapshot: SkillGroup[] = empty;

export function parseSkillGroups(raw: string | null): SkillGroup[] {
  const value: unknown = JSON.parse(raw ?? "[]");
  if (!Array.isArray(value)) throw new Error(t("Invalid skill grouping response"));
  const ids = new Set<string>();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error(t("Invalid skill grouping response"));
    const row = entry as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      !row.id ||
      ids.has(row.id) ||
      typeof row.name !== "string" ||
      !row.name.trim() ||
      !Array.isArray(row.skillNames) ||
      !row.skillNames.every((name: unknown) => typeof name === "string" && !!name.trim()) ||
      (row.source !== "ai" && row.source !== "manual") ||
      typeof row.updatedAt !== "number" ||
      !Number.isFinite(row.updatedAt)
    )
      throw new Error(t("Invalid skill grouping response"));
    ids.add(row.id);
    return {
      id: row.id,
      name: truncateGraphemes(row.name.trim(), 80),
      skillNames: [...new Set(row.skillNames as string[])],
      source: row.source,
      updatedAt: row.updatedAt,
    };
  });
}

/** Tolerant display read. Mutations use a strict read so corrupt storage is never overwritten. */
export function listSkillGroups(): SkillGroup[] {
  try {
    const raw = localStorage.getItem(SKILL_GROUPS_KEY);
    if (raw !== lastRaw) {
      snapshot = parseSkillGroups(raw);
      lastRaw = raw;
    }
    return snapshot;
  } catch {
    return empty;
  }
}
export function subscribeSkillGroups(onChange: () => void): () => void {
  return subscribePreferenceChanges([SKILL_GROUPS_KEY], event, onChange);
}
export function useSkillGroups(): SkillGroup[] {
  return useSyncExternalStore(subscribeSkillGroups, listSkillGroups, () => empty);
}
function write(groups: SkillGroup[]): SkillGroup[] {
  const valid = parseSkillGroups(JSON.stringify(groups));
  const raw = JSON.stringify(valid);
  localStorage.setItem(SKILL_GROUPS_KEY, raw);
  if (localStorage.getItem(SKILL_GROUPS_KEY) !== raw) throw new Error(t("Could not save changes"));
  lastRaw = raw;
  snapshot = valid;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(event));
  return valid;
}
function read(): SkillGroup[] {
  return parseSkillGroups(localStorage.getItem(SKILL_GROUPS_KEY));
}
function make(input: SkillGroupInput): SkillGroup {
  return {
    ...input,
    id: crypto.randomUUID(),
    source: input.source ?? "manual",
    updatedAt: Date.now(),
  };
}
export function createSkillGroup(input: SkillGroupInput): SkillGroup {
  const group = make(input);
  const groups = write([...read(), group]);
  return groups[groups.length - 1];
}
function update(id: string, change: (group: SkillGroup) => SkillGroup): void {
  const groups = read();
  if (!groups.some((group) => group.id === id)) throw new Error(t("Could not insert skill group"));
  write(
    groups.map((group) => (group.id === id ? { ...change(group), updatedAt: Date.now() } : group)),
  );
}
export function renameSkillGroup(id: string, name: string): void {
  update(id, (group) => ({ ...group, name }));
}
export function deleteSkillGroup(id: string): void {
  write(read().filter((group) => group.id !== id));
}
export function addSkillsToGroup(id: string, names: string[]): void {
  update(id, (group) => ({ ...group, skillNames: [...group.skillNames, ...names] }));
}
export function removeSkillFromGroup(id: string, name: string): void {
  update(id, (group) => ({
    ...group,
    skillNames: group.skillNames.filter((entry) => entry !== name),
  }));
}
/** One durable write: a failed destination lookup never removes the source member. */
export function moveSkillBetweenGroups(from: string, to: string, name: string): void {
  const groups = read();
  if (![from, to].every((id) => groups.some((group) => group.id === id)))
    throw new Error(t("Could not insert skill group"));
  if (from === to || !groups.find((group) => group.id === from)!.skillNames.includes(name)) return;
  write(
    groups.map((group) =>
      group.id === from
        ? {
            ...group,
            skillNames: group.skillNames.filter((entry) => entry !== name),
            updatedAt: Date.now(),
          }
        : group.id === to
          ? { ...group, skillNames: [...group.skillNames, name], updatedAt: Date.now() }
          : group,
    ),
  );
}
/** Explicit apply only. Retains corrupt storage rather than silently erasing it. */
export function replaceAllSkillGroups(inputs: SkillGroupInput[]): SkillGroup[] {
  read();
  return write(inputs.map(make));
}
/** Append a reviewed proposal atomically while retaining existing identities and collapse state. */
export function appendSkillGroups(inputs: SkillGroupInput[]): SkillGroup[] {
  return write([...read(), ...inputs.map(make)]);
}
export function resolveSkillGroup<T extends { name: string }>(
  group: Pick<SkillGroup, "skillNames">,
  skills: readonly T[],
): { skills: T[]; missingNames: string[] } {
  const catalog = new Map(skills.map((skill) => [skill.name, skill]));
  return {
    skills: group.skillNames.flatMap((name) => (catalog.has(name) ? [catalog.get(name)!] : [])),
    missingNames: group.skillNames.filter((name) => !catalog.has(name)),
  };
}
