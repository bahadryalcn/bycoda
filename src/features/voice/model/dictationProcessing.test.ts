import { describe, expect, it } from "vitest";
import { processDictationText } from "./dictationProcessing";

describe("dictation text processing", () => {
  it("applies longest aliases with Unicode word boundaries and project scope", () => {
    const dictionary = [
      { term: "Bycoda", aliases: ["buy coda", "coda"] },
      { term: "Özel", aliases: ["ozel"], projectId: "project-a" },
      { term: "Other", aliases: ["ozel"], projectId: "project-b" },
    ];
    expect(
      processDictationText("buy coda, coda! codas ozel", { dictionary, projectId: "project-a" }),
    ).toBe("Bycoda, Bycoda! codas Özel");
    expect(processDictationText("ozel", { dictionary })).toBe("ozel");
    expect(processDictationText("bycoda", { dictionary: [{ term: "Bycoda", aliases: [] }] })).toBe(
      "Bycoda",
    );
  });
  it("removes opted-in filler only as whole words and keeps correction cue", () => {
    expect(
      processDictationText("um, hello human uh actually bye", {
        removeFillers: true,
        language: "en",
        correctionCue: "um",
      }),
    ).toBe("um, hello human actually bye");
    expect(processDictationText("um hello", {})).toBe("um hello");
  });
});
