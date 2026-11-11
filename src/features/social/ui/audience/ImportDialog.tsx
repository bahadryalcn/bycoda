import { useMemo, useState } from "react";
import { formatNumber, t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { FileField } from "../../../../shared/ui/FileField";
import { Heading } from "../../../../shared/ui/Heading";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../../shared/ui/Modal";
import { SOCIAL_PLATFORM_NAMES, type SocialAccount } from "../../model/social";
import type { SocialList } from "../../model/audience";
import type { ImportResult } from "../../model/socialActions";
import type { SocialClient } from "../../model/socialClient";
import { DisabledReason } from "../common/DisabledReason";
import { LabeledSelect } from "./LabeledSelect";
import { errorMessage } from "./audienceModel";
import {
  IMPORT_FIELDS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  checkRows,
  detectFormat,
  guessMapping,
  parseDelimited,
  parseJsonTable,
  toImportJson,
  type ImportField,
  type ImportFormat,
  type ImportMapping,
  type ImportTable,
} from "./importFormat";

/** Read at render time so the labels follow the current language. */
function fieldLabel(field: ImportField): string {
  switch (field) {
    case "platformId":
      return t("Platform ID");
    case "name":
      return t("Name");
    case "profileUrl":
      return t("Profile link");
    case "tags":
      return t("Tags");
    case "language":
      return t("Language");
    case "email":
      return t("Email");
  }
}
const REQUIRED: readonly ImportField[] = ["platformId", "name"];
const REPORT_LIMIT = 20;

export type ImportDialogProps = {
  client: SocialClient;
  accounts: readonly SocialAccount[];
  lists: readonly SocialList[];
  onClose: () => void;
  onImported: (result: ImportResult) => void;
};

/** Read the first sheet of a workbook as a table. Excel is parsed only when a file is chosen. */
async function readWorkbook(file: File): Promise<ImportTable> {
  const { read, utils } = await import("xlsx");
  const book = read(await file.arrayBuffer(), { type: "array" });
  const sheet = book.Sheets[book.SheetNames[0] ?? ""];
  if (!sheet) return { headers: [], rows: [] };
  const matrix = utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  const [header = [], ...body] = matrix;
  return {
    headers: header.map((cell) => String(cell).trim()),
    rows: body.map((row) => row.map((cell) => String(cell))),
  };
}

/** Import people from a CSV, Excel or JSON file. Every row is checked before anything is sent. */
export function ImportDialog({ client, accounts, lists, onClose, onImported }: ImportDialogProps) {
  const [fileName, setFileName] = useState<string>();
  const [format, setFormat] = useState<ImportFormat>();
  const [table, setTable] = useState<ImportTable>();
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [accountId, setAccountId] = useState(accounts.length === 1 ? accounts[0]!.id : "");
  const [listId, setListId] = useState("");
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<string>();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<ImportResult>();

  const checks = useMemo(() => (table ? checkRows(table, mapping) : []), [table, mapping]);
  const ready = checks.filter((check) => check.issues.length === 0).length;
  const attention = checks.filter((check) => check.issues.length > 0);
  const missingRequired = REQUIRED.filter((field) => !mapping[field]);
  const tooMany = table !== undefined && table.rows.length > IMPORT_MAX_ROWS;

  const reason = !table
    ? t("Choose a file first.")
    : !accountId
      ? t("Choose the account the people belong to.")
      : missingRequired.length
        ? t("Match the {p0} and {p1} columns.", {
            p0: fieldLabel("platformId"),
            p1: fieldLabel("name"),
          })
        : ready === 0
          ? t("No row can be imported. Fix the rows listed below.")
          : undefined;
  const importState = reason ? { disabled: true as const, reason } : { disabled: false as const };

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setFileError(undefined);
    setResult(undefined);
    const kind = detectFormat(file.name);
    if (!kind) {
      setFileError(t("Choose a CSV, Excel (.xlsx) or JSON file."));
      return;
    }
    if (file.size > IMPORT_MAX_BYTES) {
      setFileError(t("The import can be at most 1 MiB."));
      return;
    }
    setReading(true);
    try {
      let parsed: ImportTable | { error: string };
      if (kind === "xlsx") parsed = await readWorkbook(file);
      else if (kind === "csv") parsed = parseDelimited(await file.text());
      else parsed = parseJsonTable(await file.text());
      if ("error" in parsed) {
        setFileError(parsed.error);
        setTable(undefined);
        return;
      }
      setFileName(file.name);
      setFormat(kind);
      setTable(parsed);
      setMapping(guessMapping(parsed.headers));
    } catch (err) {
      setFileError(errorMessage(err));
      setTable(undefined);
    } finally {
      setReading(false);
    }
  }

  async function runImport() {
    if (reason || !table) return;
    setImporting(true);
    setError(undefined);
    try {
      const imported = await client.audience.import({
        format: "json",
        content: toImportJson(checks),
        accountId,
        listId: listId || undefined,
      });
      setResult(imported);
      onImported(imported);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal
      title={t("Import people")}
      description={t(
        "Rows that need attention are skipped. Importing never allows messages to anyone.",
      )}
      onClose={() => {
        if (!importing) onClose();
      }}
      size="lg"
      footerStart={error ? <InlineError>{error}</InlineError> : undefined}
      footer={
        <ModalActions>
          <Button variant="ghost" disabled={importing} onClick={onClose}>
            {result ? t("Done") : t("Cancel")}
          </Button>
          {!result ? (
            <DisabledReason
              variant="primary"
              loading={importing}
              {...importState}
              onClick={() => void runImport().catch(() => undefined)}
            >
              {ready ? t("Import {p0} people", { p0: formatNumber(ready) }) : t("Import people")}
            </DisabledReason>
          ) : null}
        </ModalActions>
      }
    >
      <div className="audience-stack">
        <FileField
          label={t("File")}
          accept=".csv,.xlsx,.json,text/csv,application/json"
          disabled={reading || importing}
          onFiles={(files) =>
            void chooseFile(files[0]).catch((err: unknown) => setFileError(errorMessage(err)))
          }
        />
        {reading ? <p className="audience-muted">{t("Reading the file…")}</p> : null}
        {fileError ? <InlineError>{fileError}</InlineError> : null}

        {table ? (
          <>
            <p className="audience-muted">
              {t("{p0}: {p1} rows, {p2} ready", {
                p0: fileName ?? "",
                p1: formatNumber(table.rows.length),
                p2: formatNumber(ready),
              })}
              {format === "xlsx" ? ` · ${t("First sheet only")}` : ""}
            </p>
            {tooMany ? (
              <InlineMessage tone="warning">
                {t("Only the first {p0} rows are imported. Split the file to import the rest.", {
                  p0: IMPORT_MAX_ROWS,
                })}
              </InlineMessage>
            ) : null}
            <LabeledSelect
              label={t("Account")}
              value={accountId}
              disabled={importing}
              options={[
                { value: "", label: t("Choose an account") },
                ...accounts.map((account) => ({
                  value: account.id,
                  label: `${SOCIAL_PLATFORM_NAMES[account.platform]} · ${account.name}`,
                })),
              ]}
              onChange={setAccountId}
            />
            <LabeledSelect
              label={t("Add them to")}
              value={listId}
              disabled={importing}
              options={[
                { value: "", label: t("Only All people") },
                ...lists
                  .filter((list) => list.kind === "static")
                  .map((list) => ({ value: list.id, label: list.name })),
              ]}
              onChange={setListId}
            />
            <FieldGroup legend={t("Columns")} gap="sm">
              {IMPORT_FIELDS.map((field) => (
                <LabeledSelect
                  key={field}
                  label={
                    REQUIRED.includes(field)
                      ? `${fieldLabel(field)} · ${t("Required")}`
                      : fieldLabel(field)
                  }
                  value={mapping[field] ?? ""}
                  disabled={importing}
                  options={[
                    { value: "", label: t("Not in file") },
                    ...table.headers.map((header) => ({ value: header, label: header })),
                  ]}
                  onChange={(column) =>
                    setMapping((current) => ({ ...current, [field]: column || undefined }))
                  }
                />
              ))}
            </FieldGroup>

            {attention.length ? (
              <section aria-labelledby="import-issues-heading" className="audience-stack">
                <Heading size="item" id="import-issues-heading" className="audience-heading">
                  {t("Rows that need attention")}
                </Heading>
                <ul className="audience-list">
                  {attention.slice(0, REPORT_LIMIT).map((check) => (
                    <li key={check.row}>
                      {t("Row {p0}: {p1}", { p0: check.row, p1: check.issues.join(" ") })}
                    </li>
                  ))}
                </ul>
                {attention.length > REPORT_LIMIT ? (
                  <p className="audience-muted">
                    {t("And {p0} more rows.", { p0: attention.length - REPORT_LIMIT })}
                  </p>
                ) : null}
              </section>
            ) : null}
          </>
        ) : null}

        {result ? (
          <section aria-labelledby="import-result-heading" className="audience-stack">
            <InlineMessage tone="success">
              <span id="import-result-heading">
                {t("{p0} people imported", { p0: formatNumber(result.imported) })}
              </span>
            </InlineMessage>
            {result.rejected.length ? (
              <ul className="audience-list">
                {result.rejected.slice(0, REPORT_LIMIT).map((item) => (
                  <li key={`${item.row}:${item.reason}`}>
                    {t("Row {p0}: {p1}", { p0: item.row, p1: item.reason })}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
