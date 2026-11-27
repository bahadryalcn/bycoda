import { expect, it } from "vitest";
import type { Block } from "../model/session";
import { approvalSummary, approvalTitle } from "./approvalPresentation";

const t = ((key: string, params?: Record<string, unknown>) =>
  key.replace(/\{(p\d)\}/g, (_, name: string) => String(params?.[name]))) as never;
const shell: Block = {
  id: "b",
  role: "tool",
  text: "pnpm test\nsecond line",
  tool: { kind: "execute", status: "pending" },
  approval: { requestId: 1 },
};

it("names the action in the approval title and falls back to the generic one", () => {
  expect(approvalTitle(shell, t)).toBe("Allow Shell command?");
  expect(approvalTitle({ ...shell, tool: { kind: "mystery" } }, t)).toBe("Needs approval");
  expect(approvalTitle(undefined, t)).toBe("Needs approval");
});

it("summarizes the request on one shortened line", () => {
  expect(approvalSummary(shell)).toBe("pnpm test");
  expect(approvalSummary({ ...shell, text: "x".repeat(80) }, 10)).toHaveLength(10);
});
