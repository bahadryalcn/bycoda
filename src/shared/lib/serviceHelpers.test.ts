import { describe, expect, it } from "vitest";
import { labelColor } from "./colorUtils";
import { providerLabel } from "./providerLabel";
import { relativeDirname } from "./paths";
import { isSpace } from "./text";
import { asRecord, stringField, numberField } from "./records";

describe("ortak servis yardımcıları", () => {
  it("yalnız altı haneli renkleri kabul eder", () => {
    expect(labelColor(" #Aabb01 ")).toBe("#Aabb01");
    for (const input of ["red", "abc", "url(x)", "#aabb01ff"]) expect(labelColor(input)).toBeNull();
  });
  it("servislerin kompakt adlarını korur", () => {
    expect(["linear", "jira", "gitlab", "azuredevops", "github"].map(providerLabel)).toEqual([
      "Linear",
      "Jira",
      "GitLab",
      "ADO",
      "GitHub",
    ]);
  });
  it("Git göreli dizin etiketini çıkarır", () => {
    expect(relativeDirname("src/a.ts")).toBe("src");
    expect(relativeDirname("a.ts")).toBe("");
    expect(relativeDirname("/a.ts")).toBe("");
  });
  it("token ayrıştırıcılarında ASCII boşluk sözleşmesini korur", () => {
    expect([" ", "\n", "\t", "\r"].every(isSpace)).toBe(true);
    expect(isSpace("\u00a0")).toBe(false);
  });
  it("protokol alanlarını türlerine göre okur", () => {
    expect(asRecord(null)).toBeNull();
    expect(asRecord([])).toBeNull();
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(stringField({ a: "x" }, "a")).toBe("x");
    expect(stringField({ a: 3 }, "a")).toBeUndefined();
    expect(numberField({ a: 3 }, "a")).toBe(3);
  });
});
