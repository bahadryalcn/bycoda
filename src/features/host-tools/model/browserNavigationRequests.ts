// Explicit Browser navigation requests (a chat link click) carry an immutable ID. A panel
// consumes each ID once, so a remount, dock/detach move or Tools window reload never
// replays the navigation. Tools windows share this origin's storage, so consumption holds
// across them; the in-memory set covers blocked storage within one window.
const key = "bycoda.hostBrowser.navigationRequests.v1";
const limit = 32;
const consumed = new Set<string>();

function read(): string[] {
  try {
    const value: unknown = JSON.parse(globalThis.localStorage?.getItem(key) ?? "[]");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

/** Returns true only for the first consumer of this request ID. */
export function consumeBrowserNavigation(id: string): boolean {
  if (consumed.has(id)) return false;
  const stored = read();
  consumed.add(id);
  if (stored.includes(id)) return false;
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify([id, ...stored].slice(0, limit)));
  } catch {
    // Storage can be full or blocked; this window still never replays the request.
  }
  return true;
}
