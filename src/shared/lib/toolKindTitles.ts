const TITLES: Readonly<Record<string, string>> = {
  read: "Read",
  edit: "Edit",
  delete: "Delete",
  move: "Move",
  search: "Find",
  execute: "Shell",
  shell: "Shell",
  bash: "Shell",
  skill: "Skill",
  think: "Think",
  fetch: "Fetch",
};

/** Only the known labels are shared; provider fallback policy remains explicit. */
export function knownToolKindTitle(key: string, agents = false): string | undefined {
  if (agents && (key === "agent" || key === "task" || key === "subagent")) return "Subagent";
  return Object.prototype.hasOwnProperty.call(TITLES, key) ? TITLES[key] : undefined;
}
