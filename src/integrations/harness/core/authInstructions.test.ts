import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSignInInstructions,
  getSignInInstructions,
  offerSignInInstructionLine,
  parseSignInInstructionLine,
  signInInstructionsKey,
  subscribeSignInInstructions,
} from "./authInstructions";

const KEY = signInInstructionsKey("codex");

afterEach(() => clearSignInInstructions(KEY));

describe("parseSignInInstructionLine", () => {
  it("extracts the link from a fallback sentence and drops trailing punctuation", () => {
    expect(
      parseSignInInstructionLine(
        "If the browser did not open, visit https://auth.example.com/device?flow=abc.",
      ),
    ).toEqual({ url: "https://auth.example.com/device?flow=abc" });
  });

  it("extracts a device code announced as a code or standing alone", () => {
    expect(parseSignInInstructionLine("Enter this one-time code: ABCD-EFGH")).toEqual({
      code: "ABCD-EFGH",
    });
    expect(parseSignInInstructionLine("  ABCD-12345  ")).toEqual({ code: "ABCD-12345" });
  });

  it("reads a link and a code from the same line and strips terminal colors", () => {
    expect(
      parseSignInInstructionLine(
        "\u001b[1mOpen https://auth.example.com/activate and enter code ABCD-EFGH\u001b[0m",
      ),
    ).toEqual({ url: "https://auth.example.com/activate", code: "ABCD-EFGH" });
  });

  it("ignores lines that carry neither", () => {
    expect(parseSignInInstructionLine("")).toBeNull();
    expect(parseSignInInstructionLine("Starting login server on port 4000")).toBeNull();
    // A hyphenated identifier inside a log line is not a device code.
    expect(parseSignInInstructionLine("build ABCD-EFGH finished")).toBeNull();
  });

  it("never surfaces credentials, non-https links or oversized lines", () => {
    expect(parseSignInInstructionLine("saved token https://user:pw@auth.example.com/x")).toBeNull();
    expect(parseSignInInstructionLine("http://auth.example.com/device")).toBeNull();
    expect(parseSignInInstructionLine("https://auth.example.com/cb?access_token=FAKE")).toBeNull();
    expect(parseSignInInstructionLine("https://auth.example.com/cb?code=FAKE")).toBeNull();
    expect(parseSignInInstructionLine(`https://auth.example.com/${"a".repeat(3000)}`)).toBeNull();
    expect(parseSignInInstructionLine(`x ${"a".repeat(5000)} ABCD-EFGH code`)).toBeNull();
    expect(parseSignInInstructionLine("Logged in with key sk-fake-0000-1111")).toBeNull();
  });

  it("keeps OAuth authorization parameters that are not credentials", () => {
    const url =
      "https://auth.example.com/authorize?client_id=fake&response_type=code&state=s1&code_challenge=c1";
    expect(parseSignInInstructionLine(`Visit ${url}`)).toEqual({ url });
  });
});

describe("sign-in instruction store", () => {
  it("keeps the first link and first code of a run and notifies only on change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSignInInstructions(listener);
    offerSignInInstructionLine(KEY, "Open https://auth.example.com/one");
    const first = getSignInInstructions(KEY);
    offerSignInInstructionLine(KEY, "Open https://auth.example.com/two");
    offerSignInInstructionLine(KEY, "unrelated output");
    expect(getSignInInstructions(KEY)).toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);
    offerSignInInstructionLine(KEY, "code: ABCD-EFGH");
    expect(getSignInInstructions(KEY)).toEqual({
      url: "https://auth.example.com/one",
      code: "ABCD-EFGH",
    });
    clearSignInInstructions(KEY);
    expect(getSignInInstructions(KEY)).toBeUndefined();
    unsubscribe();
    offerSignInInstructionLine(KEY, "code: WXYZ-1234");
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("scopes instructions per provider account and treats the default account alike", () => {
    expect(signInInstructionsKey("codex")).toBe(signInInstructionsKey("codex", "default"));
    expect(signInInstructionsKey("codex", "work")).not.toBe(signInInstructionsKey("codex"));
    offerSignInInstructionLine(signInInstructionsKey("codex", "work"), "code: ABCD-EFGH");
    expect(getSignInInstructions(KEY)).toBeUndefined();
    clearSignInInstructions(signInInstructionsKey("codex", "work"));
  });
});
