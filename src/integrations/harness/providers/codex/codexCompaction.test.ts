import { expect, it } from "vitest";
import { codexAutoCompactConfig } from "./codexCompaction";

it("leaves provider defaults untouched and rejects malformed thresholds", () => {
  for (const value of [
    undefined,
    "default",
    "",
    "off",
    "0",
    "49999",
    "1000001",
    "200000.5",
    "2e5",
    "Infinity",
  ]) {
    expect(
      codexAutoCompactConfig(value === undefined ? {} : { autoCompactWindow: value }),
    ).toBeUndefined();
  }
});

it("maps supported thresholds to native per-thread config", () => {
  expect(codexAutoCompactConfig({ autoCompactWindow: "150000" })).toEqual({
    model_auto_compact_token_limit: 150_000,
  });
});
