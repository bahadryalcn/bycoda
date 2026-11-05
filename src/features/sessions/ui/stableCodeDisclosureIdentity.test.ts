// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { stableCodeDisclosureIdentity } from "./stableCodeDisclosureIdentity";

function shell(source: string): HTMLElement {
  const node = document.createElement("div");
  node.dataset.codeIdentity = JSON.stringify(["js", source]);
  return node;
}

it("keeps identities after unrelated insertions and across virtual remounts", () => {
  const first = shell("first"),
    folded = shell("folded");
  const saved = stableCodeDisclosureIdentity([first, folded]).get(folded);
  const remounted = shell("folded");
  expect(
    stableCodeDisclosureIdentity([shell("inserted"), shell("first"), remounted]).get(remounted),
  ).toBe(saved);
});

it("keeps duplicate folds independent and invalidates ambiguous count changes", () => {
  const first = shell("same"),
    second = shell("same");
  const saved = stableCodeDisclosureIdentity([first, second]);
  expect(saved.get(first)).not.toBe(saved.get(second));
  const remaining = shell("same");
  expect([...saved.values()]).not.toContain(
    stableCodeDisclosureIdentity([remaining]).get(remaining),
  );
});

it("retains an unambiguous streamed block after code grows beyond the source budget", () => {
  const block = document.createElement("div");
  block.dataset.transcriptVirtualBlockId = "original-block";
  const code = shell("short");
  block.append(code);
  const original = stableCodeDisclosureIdentity([code]).get(code);
  code.dataset.codeIdentity = "x".repeat(40_000);
  expect(stableCodeDisclosureIdentity([code]).get(code)).toBe(original);
});
