import { redactDiagnosticText } from "@bycoda/account-contracts";
import { formatDuration } from "../../../shared/i18n/format";
import { t } from "../../../shared/i18n/technical";
import { MAX_DOCUMENT_BYTES, type DocumentProblem } from "./documentViewer";

/**
 * Words a viewer failure for the active technical language. Call it while rendering so a
 * language change rewords an error already on screen. `unreadable` keeps the library's own
 * text, redacted for display and never translated.
 */
export function describeDocumentProblem(problem: DocumentProblem): string {
  switch (problem.reason) {
    case "unreadable":
      return (
        redactDiagnosticText(problem.detail).trim() ||
        t("The file could not be read; it may be corrupt.")
      );
    case "timeout":
      return t("Preview took longer than {p0}. Open it in the default app instead.", {
        p0: formatDuration(problem.ms),
      });
    case "tooLarge":
      return t("File is too large to preview (maximum {p0} MB).", {
        p0: MAX_DOCUMENT_BYTES / 1024 / 1024,
      });
    case "passwordProtected":
      return t("This file is password-protected. Open it in the default app instead.");
    case "corrupt":
      return t("The file could not be read; it may be corrupt.");
    case "workerFailed":
      return t("The preview could not be generated. Open it in the default app instead.");
    case "contentTooLarge":
      return t("Document content is too large to preview. Open it in the default app instead.");
    case "imagesTooLarge":
      return t("Document images are too large to preview. Open it in the default app instead.");
    case "notDocx":
      return t("The document is not a readable DOCX archive.");
    case "archiveIncomplete":
      return t("The document archive is incomplete.");
    case "archiveInconsistent":
      return t("The document archive directory is inconsistent.");
    case "notWorkbook":
      return t("This isn’t a valid Excel workbook; the file may be corrupt.");
    case "unclosedQuote":
      return t("A quoted table cell is not closed. Check the source file.");
    case "binaryData":
      return t("This file contains binary data and cannot be shown as a table.");
    case "invalidPageSize":
      return t("This page has invalid dimensions and can’t be drawn.");
    case "invalidRasterSize":
      return t("This page is too large to draw at this zoom. Zoom out and retry.");
  }
}

/** A viewer failure split for `DocumentMessage`: the plain reason and, when the library or host gave one, its redacted raw text. */
export function documentProblemParts(problem: DocumentProblem): {
  reason: string;
  detail?: string;
} {
  if (problem.reason !== "unreadable") return { reason: describeDocumentProblem(problem) };
  return {
    reason: t("The file could not be read; it may be corrupt."),
    detail: redactDiagnosticText(problem.detail).trim() || undefined,
  };
}
