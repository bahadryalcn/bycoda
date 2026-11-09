import { t } from "../../../shared/i18n/core";
import type { SocialAccount } from "./social";

/** Fields the Host's contact import accepts. Consent, eligibility and opt-out never come from a file. */
export const CONTACT_IMPORT_FIELDS = [
  "accountId",
  "platformId",
  "name",
  "profileUrl",
  "tags",
  "language",
  "projectIds",
] as const;
export const CONTACT_IMPORT_MAX_ROWS = 500;
export const CONTACT_IMPORT_MAX_BYTES = 1024 * 1024;

/** Audience import (CSV, XLSX, JSON) reads the same fields plus a public e-mail address. */
export const AUDIENCE_IMPORT_FIELDS = [...CONTACT_IMPORT_FIELDS, "email"] as const;
export const AUDIENCE_IMPORT_MAX_ROWS = 5000;
export const AUDIENCE_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

export type ImportContact = {
  accountId: string;
  platformId: string;
  name: string;
  profileUrl?: string;
  tags?: string[];
  language?: string;
  projectIds: string[];
  email?: string;
};

export type ContactImportRow = {
  /** 1-based position in the file. */
  row: number;
  contact?: ImportContact;
  issues: string[];
  /** Fields present in the file that the import does not read. */
  ignored: string[];
};

export type ContactImportPreview = {
  rows: ContactImportRow[];
  /** Fatal file-level problem: nothing can be previewed or imported. */
  error?: string;
};

type RowContext = {
  accounts: Set<string>;
  projects: Set<string>;
  seen: Map<string, number>;
  fields: readonly string[];
};

const text = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() && value.length <= max ? value.trim() : undefined;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** Validates one parsed record. Shared by the legacy JSON path and the audience import. */
function previewRow(raw: unknown, row: number, context: RowContext): ContactImportRow {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { row, issues: [t("Not a contact object.")], ignored: [] };
  const record = raw as Record<string, unknown>;
  const ignored = Object.keys(record).filter(
    (key) => !(context.fields as readonly string[]).includes(key),
  );
  const issues: string[] = [];
  const accountId = text(record.accountId, 300);
  if (!accountId) issues.push(t("Missing accountId."));
  else if (!context.accounts.has(accountId)) issues.push(t("Unknown account on this computer."));
  const platformId = text(record.platformId, 300);
  if (!platformId) issues.push(t("Missing platformId."));
  const name = text(record.name, 300);
  if (!name) issues.push(t("Missing name."));
  let projectIds: string[] = [];
  if (!Array.isArray(record.projectIds) || !record.projectIds.length)
    issues.push(t("Add at least one project in projectIds."));
  else if (record.projectIds.some((id) => typeof id !== "string"))
    issues.push(t("projectIds must be text values."));
  else {
    projectIds = record.projectIds as string[];
    const unknown = projectIds.filter((id) => !context.projects.has(id));
    if (unknown.length) issues.push(t("Unknown project: {p0}", { p0: unknown.join(", ") }));
  }
  let tags: string[] | undefined;
  if (record.tags !== undefined) {
    if (!Array.isArray(record.tags) || record.tags.some((tag) => typeof tag !== "string"))
      issues.push(t("tags must be a list of text values."));
    else tags = record.tags as string[];
  }
  if (record.language !== undefined && typeof record.language !== "string")
    issues.push(t("language must be text."));
  if (record.profileUrl !== undefined && typeof record.profileUrl !== "string")
    issues.push(t("profileUrl must be text."));
  let email: string | undefined;
  if (record.email !== undefined && record.email !== "") {
    const address = typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
    if (!EMAIL.test(address) || address.length > 320) issues.push(t("The email is not valid."));
    else email = address;
  }
  if (accountId && platformId) {
    const key = `${accountId}\u0000${platformId}`;
    const first = context.seen.get(key);
    if (first !== undefined)
      issues.push(t("Same account and platformId as row {p0}.", { p0: first }));
    else context.seen.set(key, row);
  }
  if (issues.length) return { row, issues, ignored };
  return {
    row,
    issues,
    ignored,
    contact: {
      accountId: accountId!,
      platformId: platformId!,
      name: name!,
      projectIds,
      ...(tags ? { tags } : {}),
      ...(typeof record.language === "string" ? { language: record.language } : {}),
      ...(typeof record.profileUrl === "string" ? { profileUrl: record.profileUrl } : {}),
      ...(email ? { email } : {}),
    },
  };
}

function rowContext(
  accounts: Pick<SocialAccount, "id">[],
  projectIds: string[],
  fields: readonly string[],
): RowContext {
  return {
    accounts: new Set(accounts.map((account) => account.id)),
    projects: new Set(projectIds),
    seen: new Map(),
    fields,
  };
}

/**
 * Maps a JSON contact list to the fields the Host reads and validates every row before any
 * request is made. The Host imports one batch atomically, so a single bad row would reject
 * everything; the preview lets the owner import only the valid rows instead.
 */
export function previewContactImport(
  source: string,
  context: { accounts: Pick<SocialAccount, "id">[]; projectIds: string[] },
): ContactImportPreview {
  if (source.length > CONTACT_IMPORT_MAX_BYTES)
    return { rows: [], error: t("The import can be at most 1 MiB.") };
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { rows: [], error: t("The file is not valid JSON.") };
  }
  if (!Array.isArray(parsed))
    return { rows: [], error: t("The file must contain a JSON contact list.") };
  if (!parsed.length) return { rows: [], error: t("The file has no contacts.") };
  if (parsed.length > CONTACT_IMPORT_MAX_ROWS)
    return {
      rows: [],
      error: t("Import at most {p0} contacts per file. Split the file.", {
        p0: CONTACT_IMPORT_MAX_ROWS,
      }),
    };
  const ctx = rowContext(context.accounts, context.projectIds, CONTACT_IMPORT_FIELDS);
  return { rows: parsed.map((raw, index) => previewRow(raw, index + 1, ctx)) };
}

/**
 * Validates already-parsed records (CSV, XLSX or JSON) for the audience import. Up to
 * AUDIENCE_IMPORT_MAX_ROWS rows; each row is checked on its own and reports its own issues.
 */
export function previewAudienceRecords(
  parsed: unknown[],
  context: { accounts: Pick<SocialAccount, "id">[]; projectIds: string[] },
): ContactImportPreview {
  if (!parsed.length) return { rows: [], error: t("The file has no contacts.") };
  if (parsed.length > AUDIENCE_IMPORT_MAX_ROWS)
    return {
      rows: [],
      error: t("Import at most {p0} contacts per file. Split the file.", {
        p0: AUDIENCE_IMPORT_MAX_ROWS,
      }),
    };
  const ctx = rowContext(context.accounts, context.projectIds, AUDIENCE_IMPORT_FIELDS);
  return { rows: parsed.map((raw, index) => previewRow(raw, index + 1, ctx)) };
}

/**
 * Splits delimited text into rows of cells (RFC 4180 quoting, CRLF or LF). The delimiter is a
 * semicolon when the header has more semicolons than commas (common in Turkish spreadsheets),
 * otherwise a comma. Blank lines are dropped.
 */
export function parseDelimitedRows(source: string): string[][] {
  const input = source.replace(/^﻿/u, "");
  const header = input.split(/\r?\n/u, 1)[0] ?? "";
  const delimiter =
    (header.match(/;/gu)?.length ?? 0) > (header.match(/,/gu)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (input[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((items) => items.some((item) => item.trim() !== ""));
}

const normalizeHeader = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/gu, "");

/**
 * Finds the column index of each audience field. A header matches a field when it is the field
 * name ignoring case, spaces, underscores and dashes. `overrides` maps field -> exact header.
 */
export function columnMapping(
  header: string[],
  overrides: Partial<Record<string, string>> = {},
): Partial<Record<(typeof AUDIENCE_IMPORT_FIELDS)[number], number>> {
  const mapping: Partial<Record<(typeof AUDIENCE_IMPORT_FIELDS)[number], number>> = {};
  for (const field of AUDIENCE_IMPORT_FIELDS) {
    const wanted = overrides[field];
    const index = header.findIndex((name) =>
      wanted !== undefined
        ? normalizeHeader(name) === normalizeHeader(wanted)
        : normalizeHeader(name) === normalizeHeader(field),
    );
    if (index >= 0) mapping[field] = index;
  }
  return mapping;
}

const LIST_FIELDS = new Set(["tags", "projectIds"]);

/** Turns delimited rows into records keyed by audience field. List cells split on ; , or |. */
export function recordsFromRows(
  rows: string[][],
  overrides: Partial<Record<string, string>> = {},
): { records: Record<string, unknown>[]; error?: string } {
  if (rows.length < 2) return { records: [], error: t("The file has no contacts.") };
  const [header, ...body] = rows;
  const mapping = columnMapping(header, overrides);
  if (mapping.platformId === undefined || mapping.name === undefined)
    return { records: [], error: t("The file needs platformId and name columns.") };
  const records = body.map((cells) => {
    const record: Record<string, unknown> = {};
    for (const [field, index] of Object.entries(mapping)) {
      const value = (cells[index ?? -1] ?? "").trim();
      if (!value) continue;
      record[field] = LIST_FIELDS.has(field)
        ? value
            .split(/[;,|]/u)
            .map((item) => item.trim())
            .filter(Boolean)
        : value;
    }
    return record;
  });
  return { records };
}
