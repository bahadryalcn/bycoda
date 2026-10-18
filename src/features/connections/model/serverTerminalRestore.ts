/** References only, embedded in the existing workspace snapshot by its owner.
 * undefined means opt-out/removal of the previously persisted field. No storage,
 * transport, process ID, endpoint snapshot, draft or shell input belongs here.
 */
export type ServerTerminalRestoreTab = { tabId: string; serverId: string };
export type ServerTerminalRestore = {
  version: 1;
  enabled: true;
  tabs: ServerTerminalRestoreTab[];
  activeTabId?: string;
};
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);

/** Both reader and writer must use this allowlist projection. Extra fields are
 * discarded; malformed references reject the entire restore instead of guessing.
 * tabId is UI identity only. A later explicit launch MUST allocate a new PTY ID.
 */
export function sanitizeServerTerminalRestore(value: unknown): ServerTerminalRestore | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || raw.enabled !== true || !Array.isArray(raw.tabs) || raw.tabs.length > 32)
    return undefined;
  const seen = new Set<string>();
  const tabs: ServerTerminalRestoreTab[] = [];
  for (const item of raw.tabs) {
    if (!item || typeof item !== "object") return undefined;
    const tab = item as Record<string, unknown>;
    if (!validId(tab.tabId) || !validId(tab.serverId) || seen.has(tab.tabId)) return undefined;
    seen.add(tab.tabId);
    tabs.push({ tabId: tab.tabId, serverId: tab.serverId });
  }
  if (raw.activeTabId !== undefined && (!validId(raw.activeTabId) || !seen.has(raw.activeTabId)))
    return undefined;
  return {
    version: 1,
    enabled: true,
    tabs,
    ...(raw.activeTabId === undefined ? {} : { activeTabId: raw.activeTabId as string }),
  };
}
