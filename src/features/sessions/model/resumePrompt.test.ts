import { describe, expect, it } from "vitest";
import { CONTINUE_PROMPT, RESUME_PROMPT } from "./inFlight";
import { resumePromptKind } from "./resumePrompt";

describe("resumePromptKind", () => {
  it("recognizes the restart prompt", () => {
    expect(resumePromptKind(CONTINUE_PROMPT)).toBe("restart");
    expect(resumePromptKind(`  ${CONTINUE_PROMPT}\n`)).toBe("restart");
  });

  it("recognizes the usage-limit resume prompt, including the old restart text", () => {
    expect(resumePromptKind(RESUME_PROMPT)).toBe("resume");
    expect(resumePromptKind(` ${RESUME_PROMPT} `)).toBe("resume");
  });

  it("ignores anything the user typed", () => {
    expect(resumePromptKind("")).toBeUndefined();
    expect(resumePromptKind("Continue")).toBeUndefined();
    expect(resumePromptKind(`${RESUME_PROMPT} please`)).toBeUndefined();
    expect(resumePromptKind(`Please: ${CONTINUE_PROMPT}`)).toBeUndefined();
  });
});
