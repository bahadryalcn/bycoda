import { t } from "../../../shared/i18n";
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

export type ImportContact = {
  accountId: string;
  platformId: string;
  name: string;
  profileUrl?: string;
  tags?: string[];
  language?: string;
  projectIds: string[];
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

const text = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() && value.length <= max ? value.trim() : undefined;

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
  const accounts = new Set(context.accounts.map((account) => account.id));
  const projects = new Set(context.projectIds);
  const seen = new Map<string, number>();
  const rows = parsed.map((raw, index): ContactImportRow => {
    const row = index + 1;
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return { row, issues: [t("Not a contact object.")], ignored: [] };
    const record = raw as Record<string, unknown>;
    const ignored = Object.keys(record).filter(
      (key) => !(CONTACT_IMPORT_FIELDS as readonly string[]).includes(key),
    );
    const issues: string[] = [];
    const accountId = text(record.accountId, 300);
    if (!accountId) issues.push(t("Missing accountId."));
    else if (!accounts.has(accountId)) issues.push(t("Unknown account on this computer."));
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
      const unknown = projectIds.filter((id) => !projects.has(id));
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
    if (accountId && platformId) {
      const key = `${accountId}\u0000${platformId}`;
      const first = seen.get(key);
      if (first !== undefined)
        issues.push(t("Same account and platformId as row {p0}.", { p0: first }));
      else seen.set(key, row);
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
      },
    };
  });
  return { rows };
}
