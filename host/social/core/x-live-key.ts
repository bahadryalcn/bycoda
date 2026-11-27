import type { SecretValueStore } from "../../secrets/secret-store";

const ref = (accountId: string) => `social:x:live:${accountId}`;

function serverUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 500 || /[\s\\]/u.test(value)) return;
  const url = URL.parse(value);
  if (
    url &&
    ["rtmp:", "rtmps:"].includes(url.protocol) &&
    /\.(?:pscp\.tv|x\.com|twitter\.com)$/i.test(url.hostname) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname !== "/"
  )
    return url.href;
}

/** Keep RTMP keys out of account snapshots, action receipts and tool results. */
export async function storeXLiveKey(
  vault: SecretValueStore,
  accountId: string,
  raw: unknown,
  server?: unknown,
  binding?: string,
) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value || value.length > 1024 || /\s/.test(value))
    throw new Error("Enter a valid X stream key.");
  const destination = server === undefined ? undefined : serverUrl(server);
  if (server !== undefined && !destination)
    throw new Error("Enter the RTMP or RTMPS URL from X Live Studio.");
  try {
    await vault.set(
      ref(accountId),
      destination ? JSON.stringify({ server: destination, key: value, binding }) : value,
    );
  } catch {
    throw new Error("The Host could not save the X stream key.");
  }
  return { stored: true };
}

export async function loadXLiveIngest(vault: SecretValueStore, accountId: string, binding: string) {
  const raw = await vault.get(ref(accountId));
  if (!raw?.startsWith("{")) return undefined; // Legacy key-only entry.
  const value = JSON.parse(raw) as { server?: unknown; key?: unknown; binding?: string };
  const server = serverUrl(value.server);
  const key = value.key;
  if (
    value.binding === binding &&
    server &&
    typeof key === "string" &&
    key &&
    key.length <= 1024 &&
    !/\s/.test(key)
  )
    return { server, key };
}
