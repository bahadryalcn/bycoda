import { expect, it } from "vitest";
import { validateFileName } from "./fileName";

it("allows case variants to reach the owning filesystem instead of guessing its case policy", () => {
  expect(validateFileName("Foo.ts", ["foo.ts"])).toBeNull();
  expect(validateFileName("FOO.ts", ["foo.ts", "Foo.ts"])).toBeNull();
  expect(validateFileName("foo.ts", ["foo.ts"])).toEqual({
    severity: "error",
    kind: "exists",
    name: "foo.ts",
  });
});

it("preserves syntactic checks before create or rename", () => {
  expect(validateFileName("", [])).toMatchObject({ kind: "empty" });
  expect(validateFileName("/foo.ts", [])).toMatchObject({ kind: "slash" });
  expect(validateFileName("../foo.ts", [])).toMatchObject({ kind: "invalid" });
  expect(validateFileName(" foo.ts", [])).toMatchObject({
    severity: "warning",
    kind: "whitespace",
  });
});
