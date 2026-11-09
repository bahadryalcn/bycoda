import {
  PROVIDER_ACCOUNT_COLORS,
  providerAccountColorValue,
} from "../../src/features/providers/model/providerAccounts";
import type { HostStore } from "../store";

type Provider = "codex" | "claude";
/** What the owner named and coloured in the desktop; colour is a palette id. */
export type ProviderAccountStyles = Partial<
  Record<Provider, Record<string, { label?: string; color?: string }>>
>;

const KEY = "providerAccountStyles";
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_ACCOUNTS = 128;

/** Keeps only well-formed names and palette colours; anything else is dropped. */
export function parseProviderAccountStyles(raw: unknown): ProviderAccountStyles {
  const result: ProviderAccountStyles = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  for (const provider of ["codex", "claude"] as const) {
    const entries = (raw as Record<string, unknown>)[provider];
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) continue;
    const styles: Record<string, { label?: string; color?: string }> = {};
    for (const [id, value] of Object.entries(entries).slice(0, MAX_ACCOUNTS)) {
      if (!ACCOUNT_ID.test(id) || !value || typeof value !== "object") continue;
      const { label, color } = value as Record<string, unknown>;
      const cleaned =
        typeof label === "string" ? label.replace(/\s+/g, " ").trim().slice(0, 48) : "";
      const palette = PROVIDER_ACCOUNT_COLORS.some((entry) => entry.id === color);
      if (cleaned || palette)
        styles[id] = {
          ...(cleaned ? { label: cleaned } : {}),
          ...(palette ? { color: color as string } : {}),
        };
    }
    result[provider] = styles;
  }
  return result;
}

export async function readProviderAccountStyles(
  store: Pick<HostStore, "ready" | "db">,
): Promise<ProviderAccountStyles> {
  await store.ready;
  return store.db.scope(async () => {
    await store.db.exec(
      "CREATE TABLE IF NOT EXISTS host_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    const row = await store.db.prepare("SELECT value FROM host_settings WHERE key=?").get(KEY);
    try {
      return row ? parseProviderAccountStyles(JSON.parse(String(row.value))) : {};
    } catch {
      return {};
    }
  });
}

/** Replaces the stored names and colours of each provider given; others keep theirs. */
export async function saveProviderAccountStyles(
  store: Pick<HostStore, "ready" | "db">,
  raw: unknown,
): Promise<ProviderAccountStyles> {
  const incoming = parseProviderAccountStyles(raw);
  const next = { ...(await readProviderAccountStyles(store)), ...incoming };
  await store.db.scope(() =>
    store.db
      .prepare(
        "INSERT INTO host_settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(KEY, JSON.stringify(next)),
  );
  return next;
}

/** The catalog with the owner's names and colours applied; unstyled accounts keep the Host's. */
export function applyProviderAccountStyles<
  T extends Partial<Record<Provider, { id: string; label: string; color?: string }[]>>,
>(catalog: T, styles: ProviderAccountStyles): T {
  const result: T = { ...catalog };
  for (const provider of ["codex", "claude"] as const) {
    const accounts = catalog[provider];
    if (!accounts) continue;
    result[provider] = accounts.map((account) => {
      const style = styles[provider]?.[account.id];
      if (!style) return account;
      return {
        ...account,
        ...(style.label && account.id !== "default" ? { label: style.label } : {}),
        ...(style.color
          ? {
              color: providerAccountColorValue({
                provider,
                id: account.id,
                color: style.color as never,
              }),
            }
          : {}),
      };
    }) as never;
  }
  return result;
}
