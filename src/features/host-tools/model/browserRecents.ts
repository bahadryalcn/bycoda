// Recently opened host browser addresses, kept per viewer for the browser start page.
// shortcut: local storage, one list for all hosts; move to Host state if recents must sync.
const key = "bycoda.hostBrowser.recentUrls";
const limit = 6;

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readBrowserRecents(): string[] {
  try {
    const value: unknown = JSON.parse(storage()?.getItem(key) ?? "[]");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string").slice(0, limit)
      : [];
  } catch {
    return [];
  }
}

function write(urls: string[]): string[] {
  try {
    storage()?.setItem(key, JSON.stringify(urls));
  } catch {
    // Storage can be full or blocked; recents are a convenience only.
  }
  return urls;
}

/** Moves the address to the front; credentials or non-web addresses are never stored. */
export function rememberBrowserUrl(url: string): string[] {
  let normalized: string;
  try {
    const parsed = new URL(url.trim());
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
      return readBrowserRecents();
    normalized = parsed.href;
  } catch {
    return readBrowserRecents();
  }
  return write(
    [normalized, ...readBrowserRecents().filter((item) => item !== normalized)].slice(0, limit),
  );
}

export function forgetBrowserUrl(url: string): string[] {
  return write(readBrowserRecents().filter((item) => item !== url));
}
