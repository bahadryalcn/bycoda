import { getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
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

/** Polling eligibility only; never grants execution or recovery authority. */
export async function isLeadWindow(): Promise<boolean> {
  let own: string;
  try {
    own = getCurrentWindow().label;
  } catch {
    return false;
  }
  if (!isWorkspaceWindow(own)) return false;
  try {
    const labels = (await getAllWebviewWindows())
      .map((window) => window.label)
      .filter(isWorkspaceWindow)
      .sort();
    return labels.length > 0 && labels[0] === own;
  } catch {
    // A failed census is unknown, not evidence that another owner retired.
    return false;
  }
}
