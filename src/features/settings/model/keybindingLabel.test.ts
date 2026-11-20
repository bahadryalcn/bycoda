import { describe, expect, it } from "vitest";
import { keybindingActionLabel } from "./keybindingLabel";

// Fake translator: stands in for a locale catalog so the test does not depend on bundled strings.
const zhCN: Record<string, string> = {
  "App: Quick Composer": "应用：快速输入",
  "App: Search": "应用：搜索",
  App: "应用程序",
};
const translateZhCN = (message: string) => zhCN[message] ?? message;

describe("keybindingActionLabel", () => {
  it("strips the category with an ASCII colon", () => {
    expect(keybindingActionLabel("Voice: Dictate", () => "Voice: Dictate")).toBe("Dictate");
  });

  it("strips the category with a full-width colon (zh-CN)", () => {
    expect(keybindingActionLabel("App: Quick Composer", translateZhCN)).toBe("快速输入");
    expect(keybindingActionLabel("App: Search", translateZhCN)).toBe("搜索");
  });

  it("keeps the full label when a translation has no category separator", () => {
    expect(keybindingActionLabel("App: Search", () => "Suche")).toBe("Suche");
  });
});
