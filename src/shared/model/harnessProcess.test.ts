import { expect, it } from "vitest";
import { requireHarnessProcessReceipt } from "./harnessProcess";

const receipt = {
  version: 1,
  backend: "native",
  sessionId: "original",
  pid: 42,
  constructionId: "12345678-1234-4123-8123-123456789abc",
};

it("retains only the original source-issued construction independently of later caller mutation", () => {
  const source = { ...receipt };
  const original = requireHarnessProcessReceipt(source, "original", "native");
  source.constructionId = "abcdef12-1234-4123-9123-123456789abc";
  expect(original).toEqual(receipt);
  expect(Object.isFrozen(original)).toBe(true);
});

it("does not upgrade old PIDs, foreign backends/routes or malformed construction receipts", () => {
  for (const value of [
    42,
    null,
    [],
    {},
    { ...receipt, version: 2 },
    { ...receipt, backend: "host" },
    { ...receipt, sessionId: "replacement" },
    { ...receipt, pid: 0 },
    { ...receipt, pid: 0x1_0000_0000 },
    { ...receipt, constructionId: undefined },
    { ...receipt, constructionId: receipt.constructionId.toUpperCase() },
    { ...receipt, constructionId: receipt.constructionId + "\n" },
    { ...receipt, authorityGeneration: 1 },
  ]) {
    expect(() => requireHarnessProcessReceipt(value, "original", "native")).toThrow();
  }
  expect(
    requireHarnessProcessReceipt({ ...receipt, backend: "host" }, "original", "host").backend,
  ).toBe("host");
});
