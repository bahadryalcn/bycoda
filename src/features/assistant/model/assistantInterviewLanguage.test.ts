import { expect, it } from "vitest";
import { LANGUAGES } from "../../../shared/i18n/languages";
import { interviewFirstQuestion, resolveInterviewLanguage } from "./assistantInterviewLanguage";

it("resolves every shared app language to its saved region tag", () => {
  for (const { tag, value } of LANGUAGES) {
    expect(resolveInterviewLanguage(tag, "en")).toBe(tag);
    expect(resolveInterviewLanguage(undefined, value)).toBe(tag);
    expect(interviewFirstQuestion(tag)).not.toBe("");
  }
});

it("falls back to the app locale and then English", () => {
  expect(resolveInterviewLanguage("ja-JP", "tr")).toBe("ja-JP");
  expect(resolveInterviewLanguage("xx", "zh-CN")).toBe("zh-CN");
  expect(resolveInterviewLanguage(undefined, "xx")).toBe("en-US");
  expect(interviewFirstQuestion("xx")).toBe(interviewFirstQuestion("en-US"));
});
