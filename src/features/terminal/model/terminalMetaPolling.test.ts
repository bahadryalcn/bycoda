import { expect, it } from "vitest";
import { shouldPollTerminalMeta } from "./terminalMetaPolling";

it("polls only a visible terminal in a visible document on a supporting platform", () => {
  const base = { onScreen: true, documentHidden: false, supported: true };
  expect(shouldPollTerminalMeta(base)).toBe(true);
  expect(shouldPollTerminalMeta({ ...base, onScreen: false })).toBe(false);
  expect(shouldPollTerminalMeta({ ...base, documentHidden: true })).toBe(false);
  expect(shouldPollTerminalMeta({ ...base, supported: false })).toBe(false);
});
