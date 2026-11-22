import { expect, it } from "vitest";
import { providerAccountKind } from "./account-kind";

it("preserves explicit kind and defaults known legacy accounts to Personal", () => {
  const accounts = {
    codex: [
      { id: "a", label: "Work", color: "", kind: "personal" as const },
      { id: "b", label: "Work", color: "", derivedKind: "work" as const },
      { id: "c", label: "Work", color: "" },
      { id: "d", label: "Office", color: "", kind: "work" as const },
      { id: "default", label: "Main", color: "" },
    ],
  };
  expect(providerAccountKind(accounts, "codex", "a")).toBe("personal");
  expect(providerAccountKind(accounts, "codex", "b")).toBe("personal");
  expect(providerAccountKind(accounts, "codex", "c")).toBe("personal");
  expect(providerAccountKind(accounts, "codex", "d")).toBe("work");
  expect(providerAccountKind(accounts, "codex", undefined)).toBe("personal");
  expect(providerAccountKind(accounts, "codex", "missing")).toBeUndefined();
  expect(providerAccountKind(accounts, "gemini", "a")).toBeUndefined();
});
