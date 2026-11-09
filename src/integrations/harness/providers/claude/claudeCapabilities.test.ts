import { expect, it } from "vitest";
import { canSteerHarness, harnessCapabilities, registerHarness } from "../../core/registry";
import { claudeAdapter } from "./claudeAdapter";

it("advertises Claude mid-query steering tracked by the command lifecycle", () => {
  registerHarness(claudeAdapter);
  expect(canSteerHarness("claude")).toBe(true);
  expect(harnessCapabilities("claude")).toMatchObject({ steer: true, compactContext: true });
});
