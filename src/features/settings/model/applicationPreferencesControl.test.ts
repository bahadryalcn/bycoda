// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  applicationPreferencesSnapshot,
  applyApplicationPreference,
} from "./applicationPreferencesControl";

const valid = () => true;

describe("transcript file reference preferences", () => {
  beforeEach(() => localStorage.clear());

  it("reads the style and every kind's tone from application.transcript", () => {
    expect(applicationPreferencesSnapshot().transcript).toMatchObject({
      fileRefs: "colored",
      fileToneCode: "info",
      fileToneFolder: "accent",
    });
  });

  it("patches the style and a tone, keeping the other fields", async () => {
    await applyApplicationPreference(
      { kind: "transcript", value: { fileRefs: "plain", fileToneDocs: "danger", cards: "solid" } },
      valid,
    );
    expect(applicationPreferencesSnapshot().transcript).toMatchObject({
      fileRefs: "plain",
      fileToneDocs: "danger",
      fileToneCode: "info",
      cards: "solid",
    });
  });

  it.each([
    { fileRefs: "rainbow" },
    { fileToneCode: "#ff0000" },
    { fileToneCode: "purple" },
    { fileToneUnknown: "info" },
    { fileToneCode: 3 },
  ])("rejects %j", async (value) => {
    await expect(applyApplicationPreference({ kind: "transcript", value }, valid)).rejects.toThrow(
      "Invalid transcript appearance field or value.",
    );
    expect(applicationPreferencesSnapshot().transcript.fileToneCode).toBe("info");
  });
});
