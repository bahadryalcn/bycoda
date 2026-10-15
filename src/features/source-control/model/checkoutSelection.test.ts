// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import {
  checkoutOptionLabel,
  checkoutRowLabels,
  defaultCheckout,
  groupCheckouts,
  loadCheckoutSelection,
  resolveCheckoutSelection,
  saveCheckoutSelection,
  sessionCheckout,
} from "./checkoutSelection";
import type { Worktree } from "./worktrees";

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
const byPath = (...trees: Worktree[]) => Object.fromEntries(trees.map((item) => [item.path, item]));

beforeEach(() => localStorage.clear());

it("resolves the deepest checkout containing the session cwd, else the main folder", () => {
  const paths = ["/repo", "/repo/.trees/a"];
  expect(sessionCheckout("/repo/.trees/a/src", paths)).toBe("/repo/.trees/a");
  expect(sessionCheckout("/elsewhere", paths)).toBeUndefined();
  const trees = byPath(main, tree("/repo/.trees/a"));
  expect(defaultCheckout("/elsewhere", paths, trees)).toBe("/repo");
  expect(defaultCheckout("/repo/.trees/a/src", paths, trees)).toBe("/repo/.trees/a");
});

it("persists explicit choices including all checkouts, and falls back when the path vanished", () => {
  const trees = byPath(main, tree("/t/a"));
  const paths = ["/repo", "/t/a"];
  expect(loadCheckoutSelection("k")).toBeNull();
  saveCheckoutSelection("k", "/t/a");
  expect(resolveCheckoutSelection(loadCheckoutSelection("k"), "/repo", paths, trees)).toBe("/t/a");
  saveCheckoutSelection("k", "");
  expect(resolveCheckoutSelection(loadCheckoutSelection("k"), "/repo", paths, trees)).toBe("");
  saveCheckoutSelection("k", "/t/gone");
  expect(resolveCheckoutSelection(loadCheckoutSelection("k"), "/t/a", paths, trees)).toBe("/t/a");
});

it("orders session, main, active, then idle checkouts", () => {
  const trees = [
    tree("/t/idle"),
    tree("/t/dirty", { dirty: true }),
    main,
    tree("/t/mine"),
    tree("/t/ahead", { unpushed: 2 }),
    tree("/t/busy", { sessionIds: ["s"] }),
  ];
  const groups = groupCheckouts(trees, "/t/mine/src");
  expect(groups.primary.map((item) => item.path)).toEqual(["/t/mine", "/repo"]);
  expect(groups.active.map((item) => item.path)).toEqual(["/t/dirty", "/t/ahead", "/t/busy"]);
  expect(groups.idle.map((item) => item.path)).toEqual(["/t/idle"]);
});

it("labels options with branch and folder, never the full path", () => {
  expect(checkoutOptionLabel(tree("/t/a", { branch: "mc/x" }), true)).toBe(
    "mc/x · a · This session",
  );
  expect(checkoutOptionLabel(tree("/t/a", { branch: null }), false)).toBe(
    "Detached · 7 · a".replace("7", "abcdef1"),
  );
});

it("drops folder names that only repeat the branch and leads detached rows with the folder", () => {
  expect(checkoutRowLabels(tree("/w/harness", { branch: "audit/2026-10-09-harness" }))).toEqual({
    title: "audit/2026-10-09-harness",
  });
  expect(checkoutRowLabels(tree("/w/wt-mc-3e93849b", { branch: "mc/3e93849b" }))).toEqual({
    title: "mc/3e93849b",
  });
  expect(checkoutRowLabels(tree("/repo/monocode", { branch: "main" }))).toEqual({
    title: "main",
    detail: "monocode",
  });
  expect(checkoutRowLabels(tree("/w/public", { branch: null }))).toEqual({
    title: "public",
    detail: "Detached abcdef1",
  });
});
