// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  insertTemplateBody,
  loadPromptTemplates,
  savePromptTemplates,
  templateInvocation,
  templateSkill,
  templateTriggerAt,
  type PromptTemplate,
} from "./promptTemplates";

beforeEach(() => localStorage.clear());

const review: PromptTemplate = {
  id: "t1",
  name: "Code review",
  body: "Review {{cursor}} for bugs",
  trigger: "rev",
};

describe("prompt template storage", () => {
  it("is empty by default and round-trips", () => {
    expect(loadPromptTemplates()).toEqual([]);
    savePromptTemplates([review, { id: "t2", name: " Notes ", body: "x" }]);
    expect(loadPromptTemplates()).toEqual([review, { id: "t2", name: "Notes", body: "x" }]);
  });

  it("returns a stable list while storage is unchanged", () => {
    savePromptTemplates([review]);
    expect(loadPromptTemplates()).toBe(loadPromptTemplates());
  });

  it("normalizes triggers and rejects bad or duplicate ones", () => {
    savePromptTemplates([{ ...review, trigger: " ;REV " }]);
    expect(loadPromptTemplates()[0]?.trigger).toBe("rev");
    expect(() => savePromptTemplates([{ ...review, trigger: "no spaces" }])).toThrow();
    expect(() => savePromptTemplates([review, { ...review, id: "t2", name: "Other" }])).toThrow(
      /twice/,
    );
    expect(() => savePromptTemplates([{ ...review, body: "  " }])).toThrow();
    expect(() => savePromptTemplates([{ ...review, name: " " }])).toThrow();
  });

  it("repairs corrupted storage when loading", () => {
    localStorage.setItem(
      "bycoda.promptTemplates",
      JSON.stringify([
        review,
        { ...review },
        { id: "t3", name: "A", body: "b", trigger: "Bad Trigger" },
        { id: "t4", name: "B", body: "b", trigger: "rev" },
        { id: 5 },
        "junk",
      ]),
    );
    expect(loadPromptTemplates()).toEqual([
      review,
      { id: "t3", name: "A", body: "b" },
      { id: "t4", name: "B", body: "b" },
    ]);
    localStorage.setItem("bycoda.promptTemplates", "{nope");
    expect(loadPromptTemplates()).toEqual([]);
  });
});

describe("template picker rows", () => {
  it("uses the trigger, else the slugged name, as the invocation", () => {
    expect(templateInvocation(review)).toBe("rev");
    expect(templateInvocation({ ...review, trigger: undefined })).toBe("code-review");
    expect(templateSkill(review)).toMatchObject({
      kind: "template",
      invocation: "rev",
      description: "Review  for bugs",
      body: review.body,
    });
  });
});

describe("insertTemplateBody", () => {
  it("replaces the range and lands the caret on {{cursor}}", () => {
    expect(insertTemplateBody("a /rev b", 2, 6, "Review {{cursor}} now")).toEqual({
      text: "a Review  now b",
      caret: 9,
    });
  });

  it("puts the caret after the body without a placeholder", () => {
    expect(insertTemplateBody("/x", 0, 2, "hello")).toEqual({
      text: "hello",
      caret: 5,
    });
  });

  it("keeps only the first {{cursor}}", () => {
    expect(insertTemplateBody("", 0, 0, "a{{cursor}}b{{cursor}}c")).toEqual({
      text: "abc",
      caret: 1,
    });
  });
});

describe("templateTriggerAt", () => {
  it("finds a saved ;trigger ending at the caret", () => {
    expect(templateTriggerAt("fix ;rev", 8, [review])).toEqual({
      start: 4,
      end: 8,
      template: review,
    });
    expect(templateTriggerAt(";rev", 4, [review])?.start).toBe(0);
  });

  it("ignores unknown triggers, mid-word semicolons and a moved caret", () => {
    expect(templateTriggerAt(";nope", 5, [review])).toBeNull();
    expect(templateTriggerAt("a;rev", 5, [review])).toBeNull();
    expect(templateTriggerAt(";rev more", 9, [review])).toBeNull();
    expect(templateTriggerAt("rev", 3, [review])).toBeNull();
  });
});
