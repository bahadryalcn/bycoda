import { expect, it } from "vitest";
import { inferAccountKind, providerAccountKind } from "./account-kind";

it("infers scope from whole label words", () => {
  expect(inferAccountKind("Acme Corp")).toBe("work");
  expect(inferAccountKind("İş hesabı")).toBe("work");
  expect(inferAccountKind("kişisel")).toBe("personal");
  expect(inferAccountKind("My home account")).toBe("personal");
  expect(inferAccountKind("Workshop")).toBeUndefined();
  expect(inferAccountKind("work and personal")).toBeUndefined();
  expect(inferAccountKind("Account 2")).toBeUndefined();
});

it("prefers explicit kind, then derived kind, then the label", () => {
  const accounts = {
    codex: [
      { id: "a", label: "Work", color: "", kind: "personal" as const },
      { id: "b", label: "Work", color: "", derivedKind: "personal" as const },
      { id: "c", label: "Work", color: "" },
      { id: "d", label: "Main", color: "" },
    ],
  };
  expect(providerAccountKind(accounts, "codex", "a")).toBe("personal");
  expect(providerAccountKind(accounts, "codex", "b")).toBe("personal");
  expect(providerAccountKind(accounts, "codex", "c")).toBe("work");
  expect(providerAccountKind(accounts, "codex", "d")).toBeUndefined();
  expect(providerAccountKind(accounts, "codex", undefined)).toBeUndefined();
  expect(providerAccountKind(accounts, "gemini", "a")).toBeUndefined();
});
