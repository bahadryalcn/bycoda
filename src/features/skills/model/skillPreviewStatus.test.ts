import { describe, expect, it } from "vitest";

import { skillPreviewStatus, type SkillPreviewStatusInput } from "./skillPreviewStatus";

const editableClean: SkillPreviewStatusInput = {
  readError: false,
  loaded: true,
  saving: false,
  dirty: false,
  editable: true,
  savedDraft: false,
};

describe("skill preview status", () => {
  it("reports a read-only skill as read-only, never as saved", () => {
    expect(skillPreviewStatus({ ...editableClean, editable: false })).toBe("read-only");
  });

  it("reports an editable clean skill as clean, not blank", () => {
    expect(skillPreviewStatus(editableClean)).toBe("clean");
  });

  it("reports saved only for the exact draft this screen wrote", () => {
    expect(skillPreviewStatus({ ...editableClean, savedDraft: true })).toBe("saved");
  });

  it("reports unsaved edits and an in-flight save", () => {
    expect(skillPreviewStatus({ ...editableClean, dirty: true })).toBe("dirty");
    expect(skillPreviewStatus({ ...editableClean, dirty: true, saving: true })).toBe("saving");
  });

  it("reports a failed read before any other state", () => {
    expect(
      skillPreviewStatus({ ...editableClean, readError: true, loaded: false, dirty: true }),
    ).toBe("failed");
  });

  it("reports loading while the text has not been read", () => {
    expect(skillPreviewStatus({ ...editableClean, loaded: false })).toBe("loading");
  });
});
