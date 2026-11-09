/**
 * Pages of the account portal that the desktop app opens in the browser. The portal origin is
 * a build-time setting (`VITE_BYCODA_ACCOUNT_PORTAL_URL`); without it every function returns
 * `null` and the UI hides the link.
 */
function portal(path: string): string | null {
  const raw = (import.meta.env?.VITE_BYCODA_ACCOUNT_PORTAL_URL as string | undefined)?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
    return `${url.origin}${path}`;
  } catch {
    return null;
  }
}

export const accountWebUrl = () => portal("/");
export const securityUrl = () => portal("/security");
export const deleteAccountUrl = () => portal("/delete");
export const exportDataUrl = () => portal("/export");
