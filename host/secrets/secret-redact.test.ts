import { describe, expect, it } from "vitest";
import { redactSecretValues } from "./secret-redact";

const TOKEN = "tok_live_abc/123+xyz=";
const secrets = [{ name: "TOKEN", value: TOKEN }];

describe("redactSecretValues", () => {
  it("replaces the plain value and its base64, base64url and URL-encoded forms", () => {
    const bytes = Buffer.from(TOKEN);
    const text = [
      `plain ${TOKEN}`,
      `b64 ${bytes.toString("base64")}`,
      `b64url ${bytes.toString("base64url")}`,
      `url ${encodeURIComponent(TOKEN)}`,
    ].join("\n");
    const out = redactSecretValues(text, secrets);
    expect(out).toBe(
      [
        "plain [secret:TOKEN]",
        "b64 [secret:TOKEN]",
        "b64url [secret:TOKEN]",
        "url [secret:TOKEN]",
      ].join("\n"),
    );
  });

  it("walks objects and arrays without mutating the input", () => {
    const input = { a: [`x ${TOKEN}`, 3, null], b: { c: TOKEN }, d: true };
    const frozen = JSON.stringify(input);
    const out = redactSecretValues(input, secrets);
    expect(out).toEqual({ a: ["x [secret:TOKEN]", 3, null], b: { c: "[secret:TOKEN]" }, d: true });
    expect(JSON.stringify(input)).toBe(frozen);
    expect(out).not.toBe(input);
  });

  it("ignores values shorter than four characters", () => {
    expect(redactSecretValues("abc abc", [{ name: "S", value: "abc" }])).toBe("abc abc");
  });

  it("replaces longer values first so a prefix secret does not split it", () => {
    const out = redactSecretValues("long-secret-value", [
      { name: "SHORT", value: "long" },
      { name: "LONG", value: "long-secret-value" },
    ]);
    expect(out).toBe("[secret:LONG]");
  });

  it("returns the value unchanged when there are no secrets and survives cycles", () => {
    const input = { a: "x" };
    expect(redactSecretValues(input, [])).toBe(input);
    const cyclic: Record<string, unknown> = { v: TOKEN };
    cyclic.self = cyclic;
    const out = redactSecretValues(cyclic, secrets) as Record<string, unknown>;
    expect(out.v).toBe("[secret:TOKEN]");
    expect(out.self).toBe(out);
  });
});
