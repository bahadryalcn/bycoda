import { expect, it } from "vitest";
import {
  readBrowserWorkspaceDrafts,
  restoreBrowserWorkspaceDrafts,
  writeBrowserDraftTransfer,
} from "./browserDraftTransfer";

it("moves browser references for every target of only the requested session", () => {
  writeBrowserDraftTransfer("/project", "a", "project", { comment: "one" });
  writeBrowserDraftTransfer("/project", "a", "machine:two", { comment: "two", inputBlocked: true });
  writeBrowserDraftTransfer("/project", "b", "project", { comment: "other" });
  const snapshot = readBrowserWorkspaceDrafts("/project", "a");
  expect(Object.keys(snapshot).sort()).toEqual(["machine:two", "project"]);
  restoreBrowserWorkspaceDrafts("/destination", "a", snapshot);
  expect(readBrowserWorkspaceDrafts("/destination", "a")["machine:two"]).toMatchObject({
    comment: "two",
    inputBlocked: true,
  });
  expect(readBrowserWorkspaceDrafts("/project", "b").project.comment).toBe("other");
});

it("rejects invalid multi-target snapshots before changing any destination draft", () => {
  writeBrowserDraftTransfer("/atomic", "a", "project", { comment: "retained" });
  expect(() => restoreBrowserWorkspaceDrafts("/atomic", "a", {
    project: { comment: "replacement" },
    "machine:invalid": { comment: "x".repeat(4001) },
  })).toThrow();
  expect(readBrowserWorkspaceDrafts("/atomic", "a").project.comment).toBe("retained");
});
