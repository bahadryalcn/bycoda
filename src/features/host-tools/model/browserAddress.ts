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
