import type { SecretValueStore } from "../../secrets/secret-store";

/** Keep RTMP keys out of account snapshots, action receipts and tool results. */
export async function storeXLiveKey(vault: SecretValueStore, accountId: string, raw: unknown) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value || value.length > 1024 || /\s/.test(value))
    throw new Error("Enter a valid X stream key.");
  try {
    await vault.set(`social:x:live:${accountId}`, value);
  } catch {
    throw new Error("The Host could not save the X stream key.");
  }
  return { stored: true };
}
