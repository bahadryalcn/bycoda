import { invoke } from "@tauri-apps/api/core";
import type { RankedFile } from "../../files";
import { fuzzyMatch } from "../../../shared/lib/fuzzy";
import { ignoredMentionMarkdown } from "../../../shared/lib/text/ignoredMentionMarkdown";
import { withTimeout } from "../../../shared/lib/withTimeout";

type InventoryEntry = { id: string; name: string; kind: string };
type ServerMention = { token: string; hint: boolean };
type ServerMentionRow = RankedFile & { server: ServerMention };
const aliases = ["srv", "server"];
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/;

export function serverMentionOf(file: { path: string }): ServerMention | undefined {
  return (file as Partial<ServerMentionRow>).server;
}

export function parseServerMentionQuery(query: string) {
  const match = /^(srv|server):(.*)$/i.exec(query);
  return match ? { alias: match[1]!.toLowerCase(), needle: match[2]! } : null;
}

export function serverMentionAliasHint(query: string) {
  return aliases.find((value) => value.startsWith(query.toLowerCase()));
}

export function serverMentionRows(query: string, inventory: readonly InventoryEntry[]) {
  const servers = inventory.filter(({ kind, id }) => kind === "ssh" && idPattern.test(id));
  const scoped = parseServerMentionQuery(query);
  if (!servers.length) return [];
  if (!scoped) {
    const alias = serverMentionAliasHint(query);
    return alias
      ? [serverMentionRow("Servers", "server-mention-hint", `${alias}:`, [], 0, true)]
      : [];
  }
  return servers
    .flatMap(({ id, name }) => {
      const match = fuzzyMatch(scoped.needle, name);
      if (!match && !id.toLowerCase().includes(scoped.needle.toLowerCase())) return [];
      return [
        serverMentionRow(
          name,
          `server-mention/${id}`,
          `${scoped.alias}:${id}`,
          match?.positions ?? [],
          match?.score ?? 0,
          false,
        ),
      ];
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 10);
}

function serverMentionRow(
  name: string,
  path: string,
  token: string,
  positions: number[],
  score: number,
  hint: boolean,
): ServerMentionRow {
  return { name, path, relative: token, score, positions, server: { token, hint } };
}

export function findServerMentionIds(text: string): string[] {
  if (!/@(?:srv|server):/i.test(text)) return [];
  const ignored = ignoredMentionMarkdown(text);
  const ids = new Set<string>();
  for (const match of text.matchAll(/(^|[\s(])@(?:srv|server):([^\s]+)/gi)) {
    if (ignored[match.index + match[1]!.length]) continue;
    const id = match[2]!.replace(/[.,;:!?)\]}"']+$/g, "");
    if (idPattern.test(id)) ids.add(id);
    if (ids.size === 5) break;
  }
  return [...ids];
}

/** Only the picker display name and stable identity leave the native inventory response. */
export async function loadServerMentionInventory(): Promise<InventoryEntry[]> {
  const records = await withTimeout(
    invoke<InventoryEntry[]>("server_inventory_list"),
    1500,
    "Saved servers",
  );
  return records.map(({ id, name, kind }) => ({ id, name, kind }));
}

export function withServerMentionContext(
  text: string,
  ids: readonly string[],
  inventory: readonly InventoryEntry[],
): string {
  const saved = new Set(inventory.filter(({ kind }) => kind === "ssh").map(({ id }) => id));
  const confirmed = ids.filter((id) => saved.has(id));
  if (!confirmed.length) return text;
  return `${text}\n\nSaved SSH references (resolve by id using servers.get on this Host): ${confirmed.join(", ")}`;
}
