/**
 * The one place that hands a URL to the operating system.
 *
 * Every "open in browser" action goes through here so the scheme is validated once
 * (no `file:`, `javascript:` or custom schemes from untrusted content), links never use
 * `target="_blank"` (which the desktop webview does not route), and tests can mock a single
 * module.
 */
import { openUrl } from "@tauri-apps/plugin-opener";

const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:"]);

export class ExternalUrlError extends Error {
  constructor(public readonly url: string) {
    super(`Refusing to open a URL with an unsupported scheme: ${url}`);
    this.name = "ExternalUrlError";
  }
}

/** True for absolute http(s)/mailto URLs that the opener may hand to the OS. */
export function isExternalUrl(value: string | URL): boolean {
  try {
    return ALLOWED_SCHEMES.has(new URL(String(value)).protocol);
  } catch {
    return false;
  }
}

/**
 * Open `url` in the user's default browser or mail client. Rejects with
 * `ExternalUrlError` for anything that is not an absolute http(s)/mailto URL.
 */
export async function openExternal(url: string | URL): Promise<void> {
  const text = String(url);
  if (!isExternalUrl(text)) throw new ExternalUrlError(text);
  await openUrl(text);
}
