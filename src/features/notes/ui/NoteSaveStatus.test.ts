import { expect, it } from "vitest";
import { noteSaveState } from "./NoteSaveStatus";

const clean = {
  deleting: false,
  saveError: null,
  titleError: undefined,
  recovering: false,
  saving: false,
  dirty: false,
};
it.each([
  [{}, "saved"],
  [{ dirty: true }, "unsaved"],
  [{ saving: true, dirty: true }, "saving"],
  [{ recovering: true, saving: true }, "recovering"],
  [{ titleError: "invalid", recovering: true }, "attention"],
  [{ saveError: "failed", titleError: "invalid" }, "failed"],
  [{ deleting: true, saveError: "failed" }, "deleting"],
] as const)("keeps save status priority for %j", (state, expected) => {
  expect(noteSaveState({ ...clean, ...state })).toBe(expected);
});
