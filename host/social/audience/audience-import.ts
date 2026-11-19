import type { ContactEmail, SocialList } from "../../../src/features/social/model/audience";
import type { SocialAccount } from "../../../src/features/social/model/social";
import {
  AUDIENCE_IMPORT_FIELDS,
  AUDIENCE_IMPORT_MAX_BYTES,
  CONTACT_IMPORT_MAX_ROWS,
  parseDelimitedRows,
  previewAudienceRecords,
  recordsFromRows,
  type ContactImportRow,
} from "../../../src/features/social/model/socialContactImport";
import type { SocialActionContext } from "../core/social-actions";
import { exact, str } from "../core/social-helpers";
import { ensurePerson, identityBlocked, isTurkish } from "./audience-person";
import { mergeEmailMatches } from "./audience-merge";
import { readAudienceWorkbook } from "./audience-sheet";

export type ImportResult = {
  imported: number;
  rejected: { row: number; issues: string[] }[];
};

const SUPPRESSED = "This person opted out or was deleted. It is not imported.";
const TOO_BIG = "The file can be at most 5 MiB.";
/** Base64 grows 4/3, and senders may wrap lines; anything past this cannot decode to the cap. */
const MAX_ENCODED_CHARS = Math.ceil((AUDIENCE_IMPORT_MAX_BYTES / 3) * 4 * 1.1);
/**
 * Valid rows written per transaction. It equals the legacy `contacts.import` batch, so a file
 * of that size or less is all-or-nothing, while a larger one never holds the Host database
 * queue for the whole file.
 */
const BATCH_ROWS = CONTACT_IMPORT_MAX_ROWS;

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

/**
 * Text content under the byte cap. A string's length counts UTF-16 units, which never exceed
 * its UTF-8 bytes, so the cheap check runs first and the exact one only for what passes it.
 */
function textWithinLimit(content: string): string {
  if (
    content.length > AUDIENCE_IMPORT_MAX_BYTES ||
    Buffer.byteLength(content) > AUDIENCE_IMPORT_MAX_BYTES
  )
    throw new Error(TOO_BIG);
  return content;
}

/** Decoded workbook bytes. The encoded size is capped before decoding, the decoded size after. */
function workbookBytes(content: string): Buffer {
  if (content.length > MAX_ENCODED_CHARS)
    throw new Error("The spreadsheet is empty or larger than 5 MiB.");
  const bytes = Buffer.from(content, "base64");
  if (!bytes.length || bytes.length > AUDIENCE_IMPORT_MAX_BYTES)
    throw new Error("The spreadsheet is empty or larger than 5 MiB.");
  return bytes;
}

/** Raw records for the chosen format. Rows are validated afterwards, one by one. */
async function recordsFrom(
  format: "csv" | "xlsx" | "json",
  content: string,
  mapping: Partial<Record<string, string>> | undefined,
): Promise<unknown[]> {
  if (format === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(textWithinLimit(content));
    } catch (error) {
      if (error instanceof Error && error.message === TOO_BIG) throw error;
      throw new Error("The file is not valid JSON.");
    }
    if (!Array.isArray(parsed)) throw new Error("The file must contain a JSON contact list.");
    return parsed;
  }
  const rows =
    format === "csv"
      ? parseDelimitedRows(textWithinLimit(content))
      : await readAudienceWorkbook(workbookBytes(content));
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

type Batch = { personIds: string[]; blocked: ImportResult["rejected"] };

/**
 * Writes one batch inside the caller's transaction. Suppression is checked in the same
 * transaction as the write, so an opt-out recorded meanwhile cannot slip through.
 */
async function writeBatch(
  ctx: SocialActionContext,
  account: SocialAccount,
  list: SocialList | undefined,
  rows: ContactImportRow[],
  now: number,
): Promise<Batch> {
  const personIds: string[] = [];
  const blocked: Batch["blocked"] = [];
  for (const row of rows) {
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
      blocked.push({ row: row.row, issues: [SUPPRESSED] });
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
  return { personIds, blocked };
}

const rowRange = (rows: ContactImportRow[]) =>
  rows.length > 1 ? `${rows[0]!.row}-${rows[rows.length - 1]!.row}` : String(rows[0]?.row ?? 0);

/**
 * audience.import (owner only). CSV, XLSX or JSON, at most 5000 rows and 5 MiB. A spreadsheet
 * is read in a worker thread. Each row is validated on its own; valid rows become contacts
 * (import provenance) and people. The import records "imported" consent as information only.
 * Suppressed identities are refused.
 *
 * Valid rows are written in batches of at most 500, each batch in one transaction (a failure
 * rolls the whole batch back, nothing of it stays). The result lists every row that was not
 * imported. If a batch fails the call throws and says how many contacts earlier batches
 * saved; importing the same file again is safe, because it updates existing people instead
 * of duplicating them.
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
  const records = (await recordsFrom(format, input.content, mapping)).map((raw) =>
    withDefaults(raw, accountId, defaultProject),
  );
  const preview = previewAudienceRecords(records, { accounts: [account], projectIds });
  if (preview.error) throw new Error(preview.error);
  const now = ctx.now();
  const rejected: ImportResult["rejected"] = preview.rows
    .filter((row) => !row.contact)
    .map((row) => ({ row: row.row, issues: row.issues }));
  const valid = preview.rows.filter((row) => row.contact);
  let imported = 0;
  for (let at = 0; at < valid.length; at += BATCH_ROWS) {
    const rows = valid.slice(at, at + BATCH_ROWS);
    let batch: Batch;
    try {
      batch = await ctx.store.transaction(() => writeBatch(ctx, account, list, rows, now));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error.";
      throw new Error(
        `The import stopped at rows ${rowRange(rows)}: ${reason} ${
          imported ? `${imported} contacts from earlier rows were saved.` : "Nothing was imported."
        } Import the file again to continue; people already saved are updated, not duplicated.`,
        { cause: error },
      );
    }
    imported += batch.personIds.length;
    rejected.push(...batch.blocked);
  }
  return { imported, rejected: rejected.sort((a, b) => a.row - b.row) };
}
