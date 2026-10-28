import { describe, expect, it } from "vitest";
import {
  editorDraftPathVisible,
  editorDraftProject,
  parseRecoveredEditorDraft,
} from "./editorDraftRecovery";
import { pathKey } from "../../../shared/lib/paths";

const descriptor = {
  version: 1,
  ownerEpoch: "a".repeat(64),
  documentId: "11111111-1111-4111-8111-111111111111",
  path: "/repo/a.txt",
  revision: 1,
  payloadDigest: "b".repeat(64),
};
describe("recovered editor row locator", () => {
  it("keeps only exact native identifiers and no plaintext", () => {
    expect(parseRecoveredEditorDraft(descriptor)).toEqual(descriptor);
    expect(parseRecoveredEditorDraft({ ...descriptor, text: "private" })).toBeNull();
    expect(parseRecoveredEditorDraft({ ...descriptor, payload: {} })).toBeNull();
  });
  it.each([
    { revision: 0 },
    { revision: 1.2 },
    { ownerEpoch: "wrong" },
    { documentId: "old-label" },
    { path: "../relative" },
    { path: "/a\0b" },
  ])("rejects invalid locator %j", (change) => {
    expect(parseRecoveredEditorDraft({ ...descriptor, ...change })).toBeNull();
  });
});
describe("recovery path visibility", () => {
  const roots = [
    { root: "/open", projectCwd: "/open" },
    { root: "/managed/worktree", projectCwd: "/secret" },
  ];
  const locked = {
    lockedGroupIds: new Set(["private"]),
    lockedProjectKeys: new Set([pathKey("/secret")]),
  };
  it("keeps locked descendants, worktree aliases and unknown origins concealed", () => {
    for (const path of [
      "/secret/a.txt",
      "/secret/nested/a",
      "/managed/worktree/a",
      "/unknown/file",
      "/open/../secret/a",
    ])
      expect(editorDraftPathVisible(path, locked, roots)).toBe(false);
    expect(editorDraftPathVisible("/open/a.txt", locked, roots)).toBe(true);
  });
  it("does not mistake a similarly prefixed directory for a locked project", () => {
    expect(
      editorDraftPathVisible("/secret-other/a", locked, [
        ...roots,
        { root: "/secret-other", projectCwd: "/secret-other" },
      ]),
    ).toBe(true);
  });
  it("allows unassigned local files after all groups are visible", () => {
    expect(
      editorDraftPathVisible(
        "/unassigned/a",
        { lockedGroupIds: new Set(), lockedProjectKeys: new Set() },
        roots,
      ),
    ).toBe(true);
    expect(editorDraftProject("/managed/worktree/a", roots)).toBe("/secret");
    expect(editorDraftProject("/unassigned/a", roots)).toBeUndefined();
  });
});
