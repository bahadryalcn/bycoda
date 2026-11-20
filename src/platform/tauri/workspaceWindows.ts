import { getAllWebviewWindows, type WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Keep in sync with src-tauri/src/window.rs::is_workspace_window.
export function isWorkspaceWindow(label: string): boolean {
  return (
    label !== "quick-composer" &&
    label !== "quick-composer-git" &&
    !label.startsWith("voice-overlay-") &&
    label !== "desktop-control-indicator"
  );
}

export interface LeadElection {
  /** True when this window is the lead. */
  leader: boolean;
  /** The lead window when it is another window; null when this window leads or none exists. */
  lead: WebviewWindow | null;
}

/**
 * One window census. Rejects when the census fails, so callers can tell unknown from another owner.
 * Polling eligibility only; never grants execution or recovery authority.
 */
export async function electLeadWindow(): Promise<LeadElection> {
  let own: string;
  try {
    own = getCurrentWindow().label;
  } catch {
    return { leader: false, lead: null };
  }
  if (!isWorkspaceWindow(own)) return { leader: false, lead: null };
  const windows = (await getAllWebviewWindows())
    .filter((window) => isWorkspaceWindow(window.label))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  const lead = windows[0] ?? null;
  if (!lead || lead.label === own) return { leader: lead !== null, lead: null };
  return { leader: false, lead };
}

/** Polling eligibility only; never grants execution or recovery authority. */
export async function isLeadWindow(): Promise<boolean> {
  try {
    return (await electLeadWindow()).leader;
  } catch {
    // A failed census is unknown, not evidence that another owner retired.
    return false;
  }
}
