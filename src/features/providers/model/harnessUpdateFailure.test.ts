import { describe, expect, it } from "vitest";
import { describeHarnessUpdateFailure } from "./harnessUpdateFailure";

describe("describeHarnessUpdateFailure", () => {
  it("words a cancelled update and an update busy elsewhere without a raw CLI detail", () => {
    expect(describeHarnessUpdateFailure("codex", { kind: "cancelled" }).headline).toBe(
      "Codex update cancelled.",
    );
    expect(describeHarnessUpdateFailure("codex", { kind: "busy" }).headline).toBe(
      "Codex is already updating in another window.",
    );
    expect(describeHarnessUpdateFailure("codex", { kind: "busy" }).detail).toBeUndefined();
  });

  it("words an updater failure with the product name and keeps the raw detail verbatim", () => {
    const detail = "error: EPERM\n  at install (bun.js:1)";
    const result = describeHarnessUpdateFailure("opencode", {
      kind: "stage",
      stage: "updater",
      detail,
    });
    expect(result.headline).toBe("OpenCode could not be updated.");
    expect(result.detail).toBe(detail);
    expect(result.toastMessage).toBe(
      "OpenCode could not be updated. error: EPERM at install (bun.js:1)",
    );
  });

  it("does not put internal stage ids or English stage labels in the headline", () => {
    const result = describeHarnessUpdateFailure("opencode", {
      kind: "stage",
      stage: "version check",
      detail: "Failed to run opencode",
    });
    expect(result.headline).not.toContain("opencode version check");
    expect(result.headline).toBe("OpenCode updated, but its version could not be verified.");
  });

  it("redacts process credentials in both details and the toast", () => {
    const result = describeHarnessUpdateFailure("opencode", {
      kind: "stage",
      stage: "updater",
      detail: "\u001b[31mRequest rejected: Bearer fake-token-12345\u001b[0m",
    });
    expect(result.detail).toBe("Request rejected: Bearer <redacted>");
    expect(result.toastMessage).toBe(
      "OpenCode could not be updated. Request rejected: Bearer <redacted>",
    );
  });

  it("reports a still-on-old-version result with no raw detail", () => {
    const result = describeHarnessUpdateFailure("opencode", {
      kind: "stillOn",
      version: "1.18.33",
    });
    expect(result).toEqual({
      headline: "OpenCode is still on 1.18.33 after updating.",
      toastMessage: "OpenCode is still on 1.18.33 after updating.",
    });
  });

  it("leaves the toast at the headline when the detail is blank", () => {
    const result = describeHarnessUpdateFailure("opencode", {
      kind: "stage",
      stage: "updater",
      detail: "   ",
    });
    expect(result.toastMessage).toBe(result.headline);
  });
});
