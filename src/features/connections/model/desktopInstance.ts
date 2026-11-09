import { getCurrentWindow } from "@tauri-apps/api/window";

const KEY = "bycoda:desktop-instance:v1";

function windowLabel(): string {
  try {
    return getCurrentWindow().label || "main";
  } catch {
    return "main"; // not inside the native shell (tests, a plain browser)
  }
}

const remembered = new Map<string, string>();

/**
 * The identity of this desktop window, kept across restarts. The host knows a
 * queue's drain lease by it, so a restarted app finds its own queues again
 * instead of meeting them as a stranger's. Each window keeps its own id.
 */
export function desktopInstanceId(): string {
  const key = `${KEY}:${windowLabel()}`;
  // Remembered for the process: when storage cannot be read or written, every
  // caller (heartbeat, queue, run lease) must still see the same identity.
  const known = remembered.get(key);
  if (known) return known;
  let id: string | undefined;
  try {
    const stored = localStorage.getItem(key);
    if (stored && /^[0-9a-f-]{16,64}$/i.test(stored)) id = stored;
    else {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
  } catch {
    // Storage is unavailable: the id lasts for this run.
  }
  id ??= crypto.randomUUID();
  remembered.set(key, id);
  return id;
}
