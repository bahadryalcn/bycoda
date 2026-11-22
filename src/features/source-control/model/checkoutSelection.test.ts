// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import {
  checkoutTitle,
  checkoutTitleWith,
  checkoutRepositoryPaths,
  checkoutRowLabels,
  dropLegacyCheckoutSelections,
  isMissingPathError,
  missingPathNamedIn,
  sessionCheckout,
} from "./checkoutSelection";
import type { Worktree } from "./worktrees";
import { t } from "../../../shared/i18n/git";

const tree = (path: string, extra: Partial<Worktree> = {}): Worktree => ({
  path,
  branch: path.split("/").pop()!,
  head: "abcdef1234",
  isMain: false,
  locked: false,
  prunable: false,
  missing: false,
  dirty: false,
  unpushed: 0,
  sessionIds: [],
  ...extra,
});
const main = tree("/repo", { isMain: true });

beforeEach(() => localStorage.clear());

it("keeps checkout titles identical with an explicit translator", () => {
  for (const entry of [main, tree("/detached", { branch: null })])
    expect(checkoutTitleWith(entry, t)).toBe(checkoutTitle(entry));
  expect(checkoutTitleWith(tree("/detached", { branch: null }), () => "Detached translated")).toBe(
    "Detached translated · abcdef1",
  );
});

it("keeps checkout children distinct, deduplicates paths and excludes outside targets", () => {
  expect(
    checkoutRepositoryPaths(["/repo", "/t/a"], {
      "/repo": ["/repo/mobile", "/repo/mobile", "/elsewhere"],
      "/t/a": ["/t/a/mobile"],
    }),
  ).toEqual(["/repo", "/repo/mobile", "/t/a", "/t/a/mobile"]);
});

it("resolves the deepest checkout containing the session cwd", () => {
  const paths = ["/repo", "/repo/.trees/a"];
  expect(sessionCheckout("/repo/.trees/a/src", paths)).toBe("/repo/.trees/a");
  expect(sessionCheckout("/elsewhere", paths)).toBeUndefined();
});

it("drops folder names that only repeat the branch and leads detached rows with the folder", () => {
  expect(checkoutRowLabels(tree("/w/harness", { branch: "audit/2026-10-09-harness" }))).toEqual({
    title: "audit/2026-10-09-harness",
  });
  expect(checkoutRowLabels(tree("/w/wt-mc-3e93849b", { branch: "mc/3e93849b" }))).toEqual({
    title: "mc/3e93849b",
  });
  expect(checkoutRowLabels(tree("/repo/upstream", { branch: "main" }))).toEqual({
    title: "main",
    detail: "upstream",
  });
  expect(checkoutRowLabels(tree("/w/public", { branch: null }))).toEqual({
    title: "public",
    detail: "Detached abcdef1",
  });
});

it("recognises not-found failures of a vanished working directory", () => {
  for (const message of [
    "fatal: cannot change to 'G:/trees/x': No such file or directory",
    "Sistem belirtilen dosyayı bulamıyor. (os error 2)",
    "G:/trees/x: Not a directory",
  ])
    expect(isMissingPathError(message)).toBe(true);
  expect(isMissingPathError("fatal: unable to access remote: timed out")).toBe(false);
  expect(
    missingPathNamedIn("fatal: cannot change to 'G:/trees/x': No such file", [
      "G:/trees/x",
      "G:/repo",
    ]),
  ).toBe("G:/trees/x");
  expect(missingPathNamedIn("fatal: cannot change to '/other': x", ["/repo"])).toBeUndefined();
});

it("drops only the retired per-session checkout choices, once", () => {
  localStorage.setItem("bycoda.sourceControl.checkout.v1:/repo", "/t/a");
  localStorage.setItem("bycoda.sourceControl.checkout.v1:/t/a", "*");
  localStorage.setItem("bycoda.other", "kept");
  dropLegacyCheckoutSelections();
  expect(localStorage.length).toBe(1);
  expect(localStorage.getItem("bycoda.other")).toBe("kept");
});
