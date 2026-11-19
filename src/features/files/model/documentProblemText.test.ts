import { afterEach, describe, expect, it } from "vitest";
import { describeDocumentProblem } from "./documentProblemText";
import type { DocumentProblem } from "./documentViewer";
import { getDomainLanguagePreference, setDomainLanguagePreference } from "../../../shared/i18n";

const REASONS: DocumentProblem[] = [
  { reason: "unreadable", detail: "Invalid PDF structure." },
  { reason: "timeout", ms: 15_000 },
  { reason: "tooLarge" },
  { reason: "passwordProtected" },
  { reason: "corrupt" },
  { reason: "workerFailed" },
  { reason: "contentTooLarge" },
  { reason: "imagesTooLarge" },
  { reason: "notDocx" },
  { reason: "archiveIncomplete" },
  { reason: "archiveInconsistent" },
  { reason: "notWorkbook" },
  { reason: "unclosedQuote" },
  { reason: "binaryData" },
  { reason: "invalidPageSize" },
  { reason: "invalidRasterSize" },
];

const previous = getDomainLanguagePreference("technical");
afterEach(async () => {
  await setDomainLanguagePreference("technical", previous);
});

describe("describeDocumentProblem", () => {
  it("words every reason in English with its actionable advice and slots filled", async () => {
    await setDomainLanguagePreference("technical", "en");
    expect(describeDocumentProblem({ reason: "tooLarge" })).toBe(
      "File is too large to preview (maximum 25 MB).",
    );
    expect(describeDocumentProblem({ reason: "timeout", ms: 15_000 })).toBe(
      "Preview took longer than 15s. Open it in the default app instead.",
    );
    expect(describeDocumentProblem({ reason: "passwordProtected" })).toContain(
      "Open it in the default app instead.",
    );
    for (const problem of REASONS) {
      expect(describeDocumentProblem(problem)).not.toMatch(/\{p\d\}/);
    }
  });

  it("translates every typed reason and keeps the library detail verbatim", async () => {
    await setDomainLanguagePreference("technical", "en");
    const english = REASONS.map(describeDocumentProblem);
    await setDomainLanguagePreference("technical", "tr");
    const turkish = REASONS.map(describeDocumentProblem);
    REASONS.forEach((problem, index) => {
      if (problem.reason === "unreadable") expect(turkish[index]).toBe(english[index]);
      else expect(turkish[index], problem.reason).not.toBe(english[index]);
    });
    expect(describeDocumentProblem({ reason: "passwordProtected" })).toBe(
      "Bu dosya parola korumalı. Bunun yerine varsayılan uygulamada açın.",
    );
  });

  it("redacts secrets in the library detail and falls back when nothing is left", () => {
    const shown = describeDocumentProblem({
      reason: "unreadable",
      detail: "Fetch failed: Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz0123456789",
    });
    expect(shown).toContain("Fetch failed");
    expect(shown).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123456789");
    expect(describeDocumentProblem({ reason: "unreadable", detail: "   " })).toBe(
      describeDocumentProblem({ reason: "corrupt" }),
    );
  });
});
