import { openUrl } from "@tauri-apps/plugin-opener";
import { IS_MAC } from "../../../platform/tauri/platform";

/** Shared by detected URLs and explicit OSC 8 hyperlinks. */
export function activateTerminalLink(event: MouseEvent, uri: string): void {
  if (event.button !== 0 || !(IS_MAC ? event.metaKey : event.ctrlKey)) return;
  // Terminal output is untrusted; never launch file or custom protocol handlers.
  try {
    const url = new URL(uri);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
  } catch {
    return;
  }
  event.preventDefault();
  void openUrl(uri).catch(() => console.warn("Could not open terminal link in the browser"));
}
