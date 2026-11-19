import { afterEach, beforeEach, expect, it } from "vitest";
import { HarnessLoginError } from "../../../integrations/harness/core/authErrors";
import { setLanguagePreference } from "../../../shared/i18n";
import {
  ProviderAccountError,
  presentProviderAccountError,
  providerAccountErrorText,
  safeProviderAccountDetail,
} from "./providerAccountError";

beforeEach(async () => {
  await setLanguagePreference("en");
});
afterEach(async () => {
  await setLanguagePreference("en");
});

it("presents every account code as a sentence without leaking the raw message", () => {
  const duplicate = new ProviderAccountError("duplicate", "raw duplicate text", { label: "Work" });
  expect(presentProviderAccountError(duplicate, "save")).toEqual({
    summary: "This account is already added as “Work”.",
  });
  expect(
    presentProviderAccountError(new ProviderAccountError("identityUnverified", "raw"), "save")
      .summary,
  ).toBe("Could not verify the signed-in account. Please try again.");
  expect(
    presentProviderAccountError(new ProviderAccountError("registrationInProgress", "raw"), "save")
      .summary,
  ).toBe("An account sign-in is already in progress for this provider.");
  expect(
    presentProviderAccountError(new ProviderAccountError("accountMissing", "raw"), "save").summary,
  ).toBe("This account no longer exists.");
});

it("keeps the sign-in verification failure's wording as redacted detail only", () => {
  const error = new ProviderAccountError("signInUnverified", "raw", {
    harness: "codex",
    detail: safeProviderAccountDetail("session expired, token=abc123secretvalue"),
  });
  const shown = presentProviderAccountError(error, "signIn");
  expect(shown.summary).toBe("Codex sign-in could not be verified.");
  expect(shown.detail).toContain("session expired");
  expect(providerAccountErrorText(error, "signIn")).not.toContain("abc123secretvalue");
});

it("translates the sentence at presentation time and keeps the label in its slot", async () => {
  const error = new ProviderAccountError("duplicate", "This account is already added as “Work”.", {
    label: "Work",
  });
  await setLanguagePreference("tr");
  expect(presentProviderAccountError(error, "save").summary).toBe(
    "Bu hesap zaten “Work” olarak eklenmiş.",
  );
  await setLanguagePreference("en");
  expect(presentProviderAccountError(error, "save").summary).toBe(
    "This account is already added as “Work”.",
  );
});

it("keeps the repair step after the original failure when cleanup fails", () => {
  const cause = new HarnessLoginError("timedOut", "claude", "raw timeout");
  const error = new ProviderAccountError("cleanupFailed", "raw", { cause });
  expect(presentProviderAccountError(error, "save").summary).toBe(
    "Claude Code sign-in timed out. Please try again. Temporary profile cleanup failed; retry before adding another account.",
  );
  const unknown = new ProviderAccountError("cleanupFailed", "raw", {
    cause: new Error("Disk locked"),
  });
  expect(presentProviderAccountError(unknown, "save")).toEqual({
    summary:
      "Could not save this account. Temporary profile cleanup failed; retry before adding another account.",
    detail: "Disk locked",
  });
});

it("maps each login code and keeps only redacted provider text as detail", () => {
  const spawn = new HarnessLoginError("spawnFailed", "grok", "raw", {
    detail: "Bearer abcdefghijklmnop failed at https://auth.example.com/cb?code=SECRET",
  });
  const shown = presentProviderAccountError(spawn, "signIn");
  expect(shown.summary).toBe("Could not start Grok Build sign-in.");
  expect(shown.detail).not.toContain("abcdefghijklmnop");
  expect(shown.detail).not.toContain("SECRET");
  expect(shown.detail).not.toContain("https://");
  expect(
    presentProviderAccountError(
      new HarnessLoginError("exited", "codex", "raw", { exitCode: 2 }),
      "signIn",
    ),
  ).toEqual({ summary: "Codex sign-in did not finish." });
  expect(
    presentProviderAccountError(new HarnessLoginError("stopFailed", "codex", "raw"), "signIn")
      .summary,
  ).toBe("Could not stop sign-in. Please try again.");
});

it("never shows an unknown error's text as the sentence and bounds and redacts it as detail", () => {
  const raw = new Error(`\u001b[31mpassword=hunter2hunter2\u001b[0m ${"x".repeat(1000)}`);
  const shown = presentProviderAccountError(raw, "remove");
  expect(shown.summary).toBe("Could not remove this account.");
  expect(shown.detail).not.toContain("hunter2");
  expect(shown.detail).not.toContain("\u001b");
  expect(shown.detail!.length).toBeLessThanOrEqual(240);
  expect(presentProviderAccountError("plain failure", "makeDefault")).toEqual({
    summary: "Could not set the default account.",
    detail: "plain failure",
  });
  expect(presentProviderAccountError(undefined, "save")).toEqual({
    summary: "Could not save this account.",
  });
});

it("presents a cancelled sign-in as cancelled, not as a failure", () => {
  expect(
    presentProviderAccountError(new DOMException("Sign-in cancelled", "AbortError"), "signIn"),
  ).toEqual({ summary: "Sign-in cancelled." });
});

it("never carries an account email or token in what it presents", () => {
  const error = new ProviderAccountError("duplicate", "This account is already added as “Work”.", {
    label: "Work",
  });
  expect(JSON.stringify(presentProviderAccountError(error, "save"))).not.toMatch(/@/);
});
