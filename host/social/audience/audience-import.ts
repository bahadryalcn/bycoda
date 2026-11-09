import { read, utils } from "xlsx";
import type { ContactEmail } from "../../../src/features/social/model/audience";
import {
  AUDIENCE_IMPORT_FIELDS,
  AUDIENCE_IMPORT_MAX_BYTES,
  AUDIENCE_IMPORT_MAX_ROWS,
  parseDelimitedRows,
  previewAudienceRecords,
  recordsFromRows,
} from "../../../src/features/social/model/socialContactImport";
import type { SocialActionContext } from "../core/social-actions";
import { exact, str } from "../core/social-helpers";
import { ensurePerson, identityBlocked, isTurkish } from "./audience-person";
import { mergeEmailMatches } from "./audience-merge";

export type ImportResult = {
  imported: number;
  rejected: { row: number; issues: string[] }[];
};

const SUPPRESSED = "This person opted out or was deleted. It is not imported.";

function parseMapping(value: unknown): Partial<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid column mapping.");
  const mapping: Record<string, string> = {};
  for (const [field, column] of Object.entries(value)) {
    if (!(AUDIENCE_IMPORT_FIELDS as readonly string[]).includes(field))
      throw new Error("Invalid column mapping.");
    mapping[field] = str(column, "column", 200);
  }
  return mapping;
}

/** First worksheet as rows of text. The file size is capped before parsing. */
function rowsFromWorkbook(content: string): string[][] {
  const bytes = Buffer.from(content, "base64");
  if (!bytes.length || bytes.length > AUDIENCE_IMPORT_MAX_BYTES)
    throw new Error("The spreadsheet is empty or larger than 5 MiB.");
  const book = read(bytes, { type: "buffer" });
  const name = book.SheetNames[0];
  const sheet = name === undefined ? undefined : book.Sheets[name];
  if (!sheet) throw new Error("The workbook has no sheet.");
  const rows = utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  if (rows.length > AUDIENCE_IMPORT_MAX_ROWS + 1)
    throw new Error(
      `Import at most ${AUDIENCE_IMPORT_MAX_ROWS} contacts per file. Split the file.`,
    );
  return rows.map((row) => row.map((cell) => String(cell ?? "")));
}

/** Raw records for the chosen format. Rows are validated afterwards, one by one. */
function recordsFrom(
  format: "csv" | "xlsx" | "json",
  content: string,
  mapping: Partial<Record<string, string>> | undefined,
): unknown[] {
  if (format === "json") {
    if (content.length > AUDIENCE_IMPORT_MAX_BYTES)
      throw new Error("The file can be at most 5 MiB.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("The file is not valid JSON.");
    }
    if (!Array.isArray(parsed)) throw new Error("The file must contain a JSON contact list.");
    return parsed;
  }
  let rows: string[][];
  if (format === "csv") {
    if (content.length > AUDIENCE_IMPORT_MAX_BYTES)
      throw new Error("The file can be at most 5 MiB.");
    rows = parseDelimitedRows(content);
  } else rows = rowsFromWorkbook(content);
  const { records, error } = recordsFromRows(rows, mapping);
  if (error) throw new Error(error);
  return records;
}

/** Fills the account and, when the account has exactly one granted project, that project. */
function withDefaults(
  raw: unknown,
  accountId: string,
  defaultProject: string | undefined,
): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const record: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  if (record.accountId === undefined) record.accountId = accountId;
  if (record.projectIds === undefined && defaultProject) record.projectIds = [defaultProject];
  return record;
}

/**
 * audience.import (owner only). CSV, XLSX or JSON, at most 5000 rows. Each row is validated on
 * its own; valid rows become contacts (import provenance) and people. The import records
 * "imported" consent as information only. Suppressed identities are refused.
 */
export async function importAudience(
  ctx: SocialActionContext,
  input: Record<string, unknown>,
): Promise<ImportResult> {
  exact(input, ["format", "content", "mapping", "accountId", "listId"]);
  const format = input.format;
  if (format !== "csv" && format !== "xlsx" && format !== "json")
    throw new Error("Invalid import format.");
  if (typeof input.content !== "string" || !input.content)
    throw new Error("Invalid import content.");
  const accountId = str(input.accountId, "account", 300);
  const account = await ctx.service.account(accountId);
  const listId = input.listId === undefined ? undefined : str(input.listId, "list", 300);
  const list = listId ? await ctx.store.getList(listId) : undefined;
  if (listId && !list) throw new Error("List not found.");
  if (list && list.kind !== "static") throw new Error("Imported people fill a static list.");
  const mapping = parseMapping(input.mapping);
  const projectIds = Object.keys(account.grants);
  const defaultProject = projectIds.length === 1 ? projectIds[0] : undefined;
  const records = recordsFrom(format, input.content, mapping).map((raw) =>
    withDefaults(raw, accountId, defaultProject),
  );
  const preview = previewAudienceRecords(records, { accounts: [account], projectIds });
  if (preview.error) throw new Error(preview.error);
  const now = ctx.now();
  const rejected: ImportResult["rejected"] = preview.rows
    .filter((row) => !row.contact)
    .map((row) => ({ row: row.row, issues: row.issues }));
  const personIds: string[] = [];
  for (const row of preview.rows) {
    const item = row.contact;
    if (!item) continue;
    const existing = await ctx.store.findPersonByHandle(account.id, item.platformId);
    if (
      await identityBlocked(
        ctx.store,
        [{ platform: account.platform, platformId: item.platformId }],
        existing?.id,
      )
    ) {
      rejected.push({ row: row.row, issues: [SUPPRESSED] });
      continue;
    }
    const contact = await ctx.service.upsertContact(ctx.principal, {
      accountId: item.accountId,
      platformId: item.platformId,
      name: item.name,
      source: "import",
      tags: item.tags ?? [],
      projectIds: item.projectIds,
      ...(item.profileUrl ? { profileUrl: item.profileUrl } : {}),
      ...(item.language ? { language: item.language } : {}),
    });
    const { person } = await ensurePerson(
      ctx.store,
      account,
      contact,
      { source: "import", basis: "imported" },
      now,
      item.projectIds,
    );
    const email: ContactEmail | undefined =
      item.email && !person.emails.some((entry) => entry.address === item.email)
        ? { address: item.email, source: "import", verified: false }
        : undefined;
    const saved = await ctx.store.putPerson({
      ...person,
      tags: [...new Set([...person.tags, ...(item.tags ?? [])])],
      emails: email ? [...person.emails, email] : person.emails,
      ...(isTurkish(person.language ?? item.language) && !person.commercialConsent
        ? { commercialConsent: { iys: "unknown" as const } }
        : {}),
      updatedAt: now,
    });
    personIds.push(saved.id);
  }
  if (list && personIds.length) {
    const eligible: string[] = [];
    for (const id of personIds) {
      const person = await ctx.store.getPerson(id);
      if (person && !(await identityBlocked(ctx.store, person.handles, person.id)))
        eligible.push(id);
    }
    await ctx.store.addMembers(list.id, eligible, { source: "import", at: now });
  }
  // Owner only, so the automatic merge may see every person.
  if (personIds.length) await mergeEmailMatches(ctx, personIds);
  return { imported: personIds.length, rejected };
}
