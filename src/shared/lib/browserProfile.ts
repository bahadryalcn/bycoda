/** Loopback web addresses use the development browser profile. */
export function isBrowserDevelopmentAddress(address: string | URL): boolean {
  try {
    const url = typeof address === "string" ? new URL(address) : address;
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
