import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listenWindowAsync } from "../../../platform/tauri/listenWindow";

/** Rust names the primary workspace window; `main` until the first answer arrives. */
let primaryWorkspaceLabel = "main";
let primaryWorkspaceTracking: Promise<void> | null = null;

/** Follow the primary label: `main`, or the oldest workspace window once `main` closes. */
export function trackPrimaryWorkspaceWindow(): Promise<void> {
  if (!primaryWorkspaceTracking) {
    primaryWorkspaceTracking = (async () => {
      await listenWindowAsync<string>("workspace-primary-changed", (event) => {
        if (typeof event.payload === "string" && event.payload) {
          primaryWorkspaceLabel = event.payload;
        }
      });
      try {
        const label = await invoke<string | null>("workspace_primary_label");
        if (typeof label === "string" && label) primaryWorkspaceLabel = label;
      } catch {
        // Keep the last known label; a later handover event still corrects it.
      }
    })().catch(() => undefined);
  }
  return primaryWorkspaceTracking;
}

/** Native window identity owns the persisted workspace layout. */
export function isPrimaryWorkspaceWindow(): boolean {
  try {
    return getCurrentWindow().label === primaryWorkspaceLabel;
  } catch {
    return false;
  }
}
