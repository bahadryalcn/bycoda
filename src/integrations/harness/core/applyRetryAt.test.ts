import { expect, it } from "vitest";
import { applyHarnessEvent } from "./apply";
import { retryFromSystem } from "../providers/claude/claudeProtocol";
import { piRetryAt } from "../providers/pi/piProtocol";
import type { Session } from "../../../features/sessions/model/session";

const base = { id: "s", blocks: [], busy: true } as unknown as Session;

it("stores the retry time with the keyed provider-retry status and replaces it on the next", () => {
  const first = applyHarnessEvent(base, {
    type: "status",
    key: "provider-retry",
    text: "Rate limited",
    retryAt: 5000,
  });
  expect(first.retryMessage).toBe("Rate limited");
  expect(first.retryAt).toBe(5000);
  const second = applyHarnessEvent(first, {
    type: "status",
    key: "provider-retry",
    text: "Rate limited",
  });
  expect(second.retryAt).toBeUndefined();
});

it("stores the retry time from a plain Retrying status", () => {
  const next = applyHarnessEvent(base, { type: "status", text: "Retrying (1/3)…", retryAt: 9000 });
  expect(next.retryAt).toBe(9000);
});

it("reads Claude's api_retry delay and Pi's delayMs", () => {
  expect(
    retryFromSystem(
      { type: "system", subtype: "api_retry", attempt: 2, max_retries: 5, retry_delay_ms: 4000 },
      1000,
    ),
  ).toEqual({ text: "Retrying (2/5)…", retryAt: 5000 });
  expect(retryFromSystem({ type: "system", subtype: "api_retry" }, 1000)).toEqual({
    text: "Retrying…",
  });
  expect(retryFromSystem({ type: "system", subtype: "status" }, 1000)).toBeUndefined();
  expect(piRetryAt({ type: "auto_retry_start", delayMs: 2500 }, 1000)).toBe(3500);
  expect(piRetryAt({ type: "auto_retry_start" }, 1000)).toBeUndefined();
});
