import { isBrowserDevelopmentAddress } from "../../../shared/lib/browserProfile";

export type BrowserSearchEngine = "disabled" | "duckduckgo" | "google" | "bing" | "custom";
export type BrowserSearchSettings = { engine: BrowserSearchEngine; template: string };
const controls = /\p{Cc}/u;

export function validBrowserHome(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    controls.test(value) ||
    value !== value.trim()
  )
    return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
    );
  } catch {
    return false;
  }
}
export function validBrowserSearchTemplate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.split("{query}").length === 2 &&
    /^https?:\/\/[^/?#]+[/?#]/i.test(value) &&
    value.indexOf("{query}") >= value.match(/^https?:\/\/[^/?#]+/i)![0].length &&
    validBrowserHome(value.replace("{query}", "search"))
  );
}
export function resolveBrowserAddress(
  input: string,
  settings: BrowserSearchSettings,
): string | undefined {
  if (controls.test(input) || input.length > 2048) return undefined;
  const value = input.trim();
  if (!value) return undefined;
  if (validBrowserHome(value)) return value;
  if (/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:[/?#]|$)/i.test(value)) {
    const address = `http://${value}`;
    return validBrowserHome(address) ? address : undefined;
  }
  // Never reinterpret an invalid URL or a scheme as a search.
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || /^(?:\/\/|[^\s]+@)/.test(value)) return undefined;
  if (settings.engine === "disabled") return undefined;
  const template =
    settings.engine === "custom"
      ? settings.template
      : {
          duckduckgo: "https://duckduckgo.com/?q={query}",
          google: "https://www.google.com/search?q={query}",
          bing: "https://www.bing.com/search?q={query}",
        }[settings.engine];
  if (!validBrowserSearchTemplate(template)) return undefined;
  try {
    const resolved = template.replace("{query}", encodeURIComponent(value));
    return validBrowserHome(resolved) ? resolved : undefined;
  } catch {
    return undefined;
  }
}
/** Direct native previews admit only local web servers, excluding the app's own dev origin. */
export function isLocalBrowserAddress(address: string) {
  try {
    const url = new URL(address);
    return (
      isBrowserDevelopmentAddress(url) && url.port !== "1420" && !url.username && !url.password
    );
  } catch {
    return false;
  }
}
