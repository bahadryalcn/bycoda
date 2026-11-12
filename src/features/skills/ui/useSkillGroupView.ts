import { useState } from "react";
import { createStoredSetting } from "../../../shared/lib/storedSetting";
import type { DragEvent } from "react";
import { addSkillsToGroup, moveSkillBetweenGroups, removeSkillFromGroup } from "../index";

const preference = createStoredSetting<{ view: string; collapsed: string[] }>({
  key: "bycoda.skillGroups.view.v1",
  serialize: JSON.stringify,
  fallback: { view: "all", collapsed: [] },
  parse: (raw) => {
    const value = JSON.parse(raw);
    return {
      view: value.view === "groups" ? "groups" : "all",
      collapsed: Array.isArray(value.collapsed)
        ? value.collapsed.filter((id: unknown) => typeof id === "string")
        : [],
    };
  },
});

export function useSkillGroupView() {
  const [state, setState] = useState(() => preference.load());
  const update = (next: typeof state) => {
    setState(next);
    // Presentation preferences must not block working with the library when storage is unavailable.
    try {
      preference.save(next);
    } catch {
      /* Session state remains usable. */
    }
  };
  return {
    ...state,
    setView: (view: string) => update({ ...state, view }),
    toggle: (id: string) =>
      update({
        ...state,
        collapsed: state.collapsed.includes(id)
          ? state.collapsed.filter((key) => key !== id)
          : [...state.collapsed, id],
      }),
  };
}

const dragType = "application/x-bycoda-skill-group";
export function startSkillDrag(event: DragEvent, name: string, source?: string) {
  event.dataTransfer.setData(dragType, JSON.stringify({ name, source }));
  event.dataTransfer.effectAllowed = "move";
}
export function acceptSkillDrag(event: DragEvent) {
  if (event.dataTransfer.types.includes(dragType)) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }
}
export function dropSkill(
  event: DragEvent,
  target: string | undefined,
  installed: ReadonlySet<string>,
) {
  if (!event.dataTransfer.types.includes(dragType)) return;
  event.preventDefault();
  const value: unknown = JSON.parse(event.dataTransfer.getData(dragType));
  if (!value || typeof value !== "object") return;
  const { name, source } = value as { name?: unknown; source?: unknown };
  if (
    typeof name !== "string" ||
    !installed.has(name) ||
    (source !== undefined && typeof source !== "string")
  )
    return;
  if (target && source) moveSkillBetweenGroups(source, target, name);
  else if (target) addSkillsToGroup(target, [name]);
  else if (source) removeSkillFromGroup(source, name);
}
