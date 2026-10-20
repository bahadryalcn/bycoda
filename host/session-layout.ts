import type { HostSessionLayout } from "../src/features/connections/model/protocol";

/** Optional organization never weakens the surrounding project privacy validation. */
export function parseSessionLayout(input: unknown): HostSessionLayout | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const value = input as Record<string, unknown>;
  const text = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 1000 && !v.includes("\0");
  const list = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 10000 && v.every(text);
  if (!Array.isArray(value.folders) || value.folders.length > 10000 || !value.order || typeof value.order !== "object" || Array.isArray(value.order)) return;
  const folders: HostSessionLayout["folders"] = [];
  const seen = new Set<string>();
  for (const raw of value.folders) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const folder = raw as Record<string, unknown>;
    if (!text(folder.id) || !text(folder.name) || seen.has(folder.id) || !list(folder.sessionIds) || typeof folder.collapsed !== "boolean") return;
    if (folder.parentId !== undefined && !text(folder.parentId)) return;
    seen.add(folder.id);
    folders.push({ id: folder.id, name: folder.name, sessionIds: [...new Set(folder.sessionIds)], collapsed: folder.collapsed,
      ...(typeof folder.parentId === "string" ? { parentId: folder.parentId } : {}),
      ...(typeof folder.ordered === "boolean" ? { ordered: folder.ordered } : {}),
      ...(typeof folder.pinned === "boolean" ? { pinned: folder.pinned } : {}),
    });
  }
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  for (const folder of folders) {
    const ancestors = new Set<string>();
    let current: typeof folder | undefined = folder;
    while (current) {
      if (ancestors.has(current.id) || ancestors.size >= 4) return;
      ancestors.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  const order: HostSessionLayout["order"] = {};
  for (const key of ["loose", "pinned"] as const) {
    const ids = (value.order as Record<string, unknown>)[key];
    if (ids !== undefined) {
      if (!list(ids)) return;
      order[key] = [...new Set(ids)];
    }
  }
  return { folders, order };
}
