// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { installAttachmentSelectionPolicy } from "./attachmentSelectionPolicy";

it("snaps native selections without recursion and defers during composition", () => {
  const el = document.createElement("textarea");
  el.value = "[image1]";
  const remove = installAttachmentSelectionPolicy(el, () => [{ kind: "image" }]);
  const set = vi.spyOn(el, "setSelectionRange");
  el.setSelectionRange(3, 3);
  expect([el.selectionStart, el.selectionEnd]).toEqual([0, 0]);
  expect(set).toHaveBeenCalledTimes(2);
  el.dispatchEvent(new CompositionEvent("compositionstart"));
  el.setSelectionRange(3, 3);
  expect(el.selectionStart).toBe(3);
  el.dispatchEvent(new CompositionEvent("compositionend"));
  expect(el.selectionStart).toBe(0);
  remove();
});
