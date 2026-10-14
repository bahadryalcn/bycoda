import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_LIST_DISPLAY,
  parseSessionListDisplay,
  shortModelName,
} from "./sessionListDisplay";

describe("session list display preference", () => {
  it("falls back per field when stored data is missing or invalid", () => {
    expect(parseSessionListDisplay(null)).toEqual(DEFAULT_SESSION_LIST_DISPLAY);
    expect(parseSessionListDisplay("{not json")).toEqual(DEFAULT_SESSION_LIST_DISPLAY);
    expect(parseSessionListDisplay('{"density":"huge","showModel":"no","striped":false}')).toEqual({
      ...DEFAULT_SESSION_LIST_DISPLAY,
      striped: false,
    });
    expect(parseSessionListDisplay('{"groupDelayMs":99999}').groupDelayMs).toBe(1500);
    expect(parseSessionListDisplay('{"groupDelayMs":"slow"}').groupDelayMs).toBe(700);
    expect(parseSessionListDisplay('{"density":"detailed","showBranch":false}')).toEqual({
      ...DEFAULT_SESSION_LIST_DISPLAY,
      density: "detailed",
      showBranch: false,
    });
  });

  it("shortens model names to their family", () => {
    expect(shortModelName("Claude Opus 5.5")).toBe("Opus");
    expect(shortModelName("Sonnet 4.6")).toBe("Sonnet");
    expect(shortModelName("GPT-6.1-Sol")).toBe("GPT-6.1");
    expect(shortModelName("gpt-5.4")).toBe("gpt-5.4");
  });
});
