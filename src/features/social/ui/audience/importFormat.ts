/**
 * Reads CSV and JSON text into one table, suggests a column mapping, checks every row and builds
 * the JSON the Host imports. Pure: no Host call, no file access, no React.
 */
import { t } from "../../../../shared/i18n";

export const IMPORT_FIELDS = [
  "platformId",
  "name",
  "profileUrl",
  "tags",
  "language",
  "email",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
/** Target field to the file column that feeds it. Missing keys mean "not mapped". */
export type ImportMapping = Partial<Record<ImportField, string>>;

export type ImportTable = { headers: string[]; rows: string[][] };
export type ImportFormat = "csv" | "xlsx" | "json";

/** shortcut: same cap as the contact import; raise it together with the Host limit. */
export const IMPORT_MAX_ROWS = 500;
/** shortcut: 1 MiB like the other import; the Host enforces its own limit too. */
export const IMPORT_MAX_BYTES = 1024 * 1024;

export function detectFormat(fileName: string): ImportFormat | undefined {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".json")) return "json";
  return undefined;
}

/** Splits one line on the delimiter. Handles double quotes and doubled quotes inside them. */
function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      cells.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

/**
 * CSV with comma, semicolon or tab separators. The first non-empty line is the header.
 * shortcut: a quoted cell containing a line break is not supported; such rows are split.
 */
export function parseDelimited(text: string): ImportTable {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (!lines.length) return { headers: [], rows: [] };
  const first = lines[0]!;
  const delimiter = [",", ";", "\t"].reduce((best, candidate) =>
    first.split(candidate).length > first.split(best).length ? candidate : best,
  );
  const [headerLine, ...bodyLines] = lines;
  return {
    headers: splitLine(headerLine!, delimiter),
    rows: bodyLines.map((line) => splitLine(line, delimiter)),
  };
}

/** A JSON array of objects. The headers are the keys in the order they first appear. */
export function parseJsonTable(text: string): ImportTable | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: t("The file is not valid JSON.") };
  }
  if (!Array.isArray(parsed)) return { error: t("The file must contain a JSON list of people.") };
  const headers: string[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    for (const key of Object.keys(item)) if (!headers.includes(key)) headers.push(key);
  }
  const rows = parsed
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) =>
      headers.map((key) => {
        const value = item[key];
        if (value === undefined || value === null) return "";
        return Array.isArray(value) ? value.join(", ") : String(value);
      }),
    );
  return { headers, rows };
}

const ALIASES: Record<ImportField, readonly string[]> = {
  platformId: ["platformid", "userid", "id"],
  name: ["name", "fullname", "displayname"],
  profileUrl: ["profileurl", "url", "link", "profilelink"],
  tags: ["tags", "tag", "labels"],
  language: ["language", "lang", "locale"],
  email: ["email", "emailaddress", "mail"],
};

/** Matches column names to fields by normalized name. The owner can change every choice. */
export function guessMapping(headers: readonly string[]): ImportMapping {
  const normalized = new Map(
    headers.map((header) => [header.toLowerCase().replace(/[^a-z]/g, ""), header]),
  );
  const mapping: ImportMapping = {};
  for (const field of IMPORT_FIELDS) {
    const match = ALIASES[field].map((alias) => normalized.get(alias)).find(Boolean);
    if (match) mapping[field] = match;
  }
  return mapping;
}

export type ImportRowCheck = {
  /** 1-based row number in the file, not counting the header. */
  row: number;
  values: Partial<Record<ImportField, string>>;
  issues: string[];
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Checks the first rows against the mapping. Every issue names the problem in plain words. */
export function checkRows(table: ImportTable, mapping: ImportMapping): ImportRowCheck[] {
  const index = (header: string | undefined) =>
    header === undefined ? -1 : table.headers.indexOf(header);
  const seen = new Map<string, number>();
  return table.rows.slice(0, IMPORT_MAX_ROWS).map((cells, position): ImportRowCheck => {
    const row = position + 1;
    const values: ImportRowCheck["values"] = {};
    for (const field of IMPORT_FIELDS) {
      const column = index(mapping[field]);
      if (column >= 0) values[field] = (cells[column] ?? "").trim();
    }
    const issues: string[] = [];
    if (!values.platformId) issues.push(t("No platform ID in this row."));
    if (!values.name) issues.push(t("No name in this row."));
    if (values.email && !EMAIL.test(values.email))
      issues.push(t("The email address is not valid."));
    if (values.platformId) {
      const first = seen.get(values.platformId);
      if (first !== undefined) issues.push(t("Same platform ID as row {p0}.", { p0: first }));
      else seen.set(values.platformId, row);
    }
    return { row, values, issues };
  });
}

/** The valid rows as the JSON the Host imports: target field names, tags as a list. */
export function toImportJson(checks: readonly ImportRowCheck[]): string {
  const rows = checks
    .filter((check) => check.issues.length === 0)
    .map(({ values }) => ({
      platformId: values.platformId,
      name: values.name,
      ...(values.profileUrl ? { profileUrl: values.profileUrl } : {}),
      ...(values.language ? { language: values.language } : {}),
      ...(values.email ? { email: values.email } : {}),
      ...(values.tags
        ? {
            tags: values.tags
              .split(/[,;]/)
              .map((tag) => tag.trim())
              .filter(Boolean),
          }
        : {}),
    }));
  return JSON.stringify(rows);
}
