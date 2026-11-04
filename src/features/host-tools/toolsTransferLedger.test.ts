import { expect, it } from "vitest";
import {
  ToolsTransferLedger,
  toolsTransferEdits,
  toolsTransferFingerprint,
  type ToolsWorkspaceTransfer,
} from "./toolsTransferLedger";
it("deduplicates exact source/scope/operation and keeps completed receipts beyond sixty-four moves", () => {
  const ledger = new ToolsTransferLedger<{ done: true }>();
  for (let i = 0; i < 100; i++) {
    ledger.begin(String(i), "main", "scope", "fingerprint");
    ledger.complete(String(i), { done: true });
  }
  expect(ledger.find("0", "main", "scope", "fingerprint")?.ack).toEqual({ done: true });
  expect(() => ledger.find("0", "other", "scope", "fingerprint")).toThrow(
    "Both workspaces retained",
  );
});
it("blocks unresolved capacity without dropping original operations", () => {
  const ledger = new ToolsTransferLedger<true>();
  for (let i = 0; i < 8; i++) ledger.begin(String(i), "main", "scope", "fingerprint");
  expect(() => ledger.begin("9", "main", "scope", "fingerprint")).toThrow("unresolved");
  expect(ledger.find("0", "main", "scope", "fingerprint")).toBeDefined();
});
it("excludes readonly samples from source edit guards while preserving user comments and scopes", async () => {
  const session = { cwd: "G:/Repo", sessionId: "one", title: "One" };
  const before: ToolsWorkspaceTransfer = {
    browserDrafts: { project: { comment: "draft" } },
    toolsDrafts: {},
  };
  const after: ToolsWorkspaceTransfer = {
    ...before,
    toolsDrafts: { project: { diagnostics: { samples: [] } } },
  };
  expect(await toolsTransferFingerprint(toolsTransferEdits(session, before))).toBe(
    await toolsTransferFingerprint(toolsTransferEdits(session, after)),
  );
  expect(
    await toolsTransferFingerprint(
      toolsTransferEdits(session, { ...after, browserDrafts: { project: { comment: "edited" } } }),
    ),
  ).not.toBe(await toolsTransferFingerprint(toolsTransferEdits(session, before)));
});
