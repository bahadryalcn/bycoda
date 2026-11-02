import { expect, it } from "vitest";
import {
  assistantTextLimits,
  AssistantTextPreflightError,
} from "./assistant-text-budget";

it("reserves estimated input headroom and splits the remaining allowance across real phases", () => {
  expect(assistantTextLimits("a".repeat(400), 1000)).toEqual({
    maxOutputTokens: 900,
    maxOutputChars: 3600,
  });
  expect(assistantTextLimits("a".repeat(400), 1000, 2)).toEqual({
    maxOutputTokens: 450,
    maxOutputChars: 1800,
  });
  expect(assistantTextLimits("a", 100000)).toEqual({
    maxOutputTokens: 99999,
    maxOutputChars: 64000,
  });
  expect(assistantTextLimits("你", 3)).toEqual({
    maxOutputTokens: 2,
    maxOutputChars: 8,
  });
});
it("refuses before a provider request when the estimate leaves no output headroom", () => {
  for (const cap of [0, 100, NaN, Infinity, 1.1])
    expect(() => assistantTextLimits("a".repeat(400), cap)).toThrow(
      AssistantTextPreflightError,
    );
});
