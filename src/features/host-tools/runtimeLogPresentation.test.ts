import { expect, it } from "vitest";
import { runtimeLogDisplayLevel } from "./runtimeLogPresentation";

it("distinguishes Next.js requests, successful builds, and normal output", () => {
  for (const [message, expected] of [
    ["GET / 200 in 12ms", "http"],
    ["POST /api 500 in 7ms", "error"],
    ["GET /missing 404 in 2ms", "error"],
    ["✓ Ready in 100ms", "success"],
    ["✓ Compiled / in 2s", "success"],
    ["Account response", "info"],
  ] as const)
    expect(runtimeLogDisplayLevel({ level: "info", message })).toBe(expected);
});

it("preserves explicit severity even when the message mentions success or HTTP", () => {
  for (const level of ["error", "warn", "debug"] as const)
    expect(runtimeLogDisplayLevel({ level, message: "GET / 200 in 2ms" })).toBe(level);
});
