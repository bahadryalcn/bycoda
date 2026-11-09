import { invoke } from "@tauri-apps/api/core";

export const TAB_GROUP_LOGOS_CHANGED = "bycoda:tab-group-logos-changed";

let logoDisplayRevision = 0;

export function tabGroupLogoDisplayRevision(): number {
  return logoDisplayRevision;
}

export function notifyTabGroupLogosChanged(): void {
  logoDisplayRevision += 1;
  // Appearance sync writes mascots outside a window; there is nothing to repaint there.
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(TAB_GROUP_LOGOS_CHANGED));
}

// shortcut: entries of removed projects stay until the key is next detected; prune if it grows.
const DETECTED_KEY = "bycoda:tab-group:detected-logos";
const DETECT_CONCURRENCY = 2;

/** Project key → app-local copy of the logo the project ships; `""` means it ships none. */
let detected: Record<string, string> | undefined;
const checked = new Set<string>();
const queue: string[] = [];
let running = 0;
let changed = false;

function readDetected(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(DETECTED_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function settle(project: string, path: string): void {
  detected ??= readDetected();
  if (detected[project] === path) return;
  detected[project] = path;
  changed = true;
  try {
    localStorage.setItem(DETECTED_KEY, JSON.stringify(detected));
  } catch {
    // The in-memory result still shows this session; detection reruns next launch.
  }
}

function pump(): void {
  while (running < DETECT_CONCURRENCY && queue.length) {
    const project = queue.shift()!;
    running += 1;
    invoke<string | null>("detect_project_logo", { project })
      .then((path) => settle(project, typeof path === "string" ? path : ""))
      .catch(() => undefined) // Unavailable outside the desktop app; keep the last answer.
      .finally(() => {
        running -= 1;
        if (queue.length) return pump();
        if (running === 0 && changed) {
          changed = false;
          notifyTabGroupLogosChanged();
        }
      });
  }
}

/**
 * The logo a local project ships (favicon, app icon), detected once per launch
 * and remembered across launches so the rail does not flash its mascot first.
 */
export function detectedProjectLogo(project: string): string | null {
  if (typeof window === "undefined" || !project || project.startsWith("remote://")) return null;
  detected ??= readDetected();
  if (!checked.has(project)) {
    checked.add(project);
    queue.push(project);
    queueMicrotask(pump);
  }
  return detected[project] || null;
}
