import { expect, it } from "vitest";
import { sessionProgressHint } from "./voiceSessionProgress";
it("reports quiet observation without claiming completion and resets on fresh progress", () => {
  expect(sessionProgressHint(true, 1000, 90_999)).toBe("working");
  expect(sessionProgressHint(true, 1000, 91_000)).toBe("quiet");
  expect(sessionProgressHint(true, 91_000, 91_001)).toBe("working");
  expect(sessionProgressHint(false, 1000, 999_000)).toBe("idle");
  expect(sessionProgressHint(true, 1000, 0)).toBe("working");
});
