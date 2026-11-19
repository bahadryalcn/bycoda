import { describe, expect, it, vi } from "vitest";
import { ignoreMissingControlMethod } from "./acpControlRejection";
import { JsonRpcResponseError } from "./jsonRpc";

const secret = "sk-abcdef1234567890abcdef";

describe("ignoreMissingControlMethod", () => {
  it("swallows only method-not-found as an optional capability", () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    expect(() =>
      ignoreMissingControlMethod(
        "grok",
        "set_mode",
        new JsonRpcResponseError("Method not found", -32601),
      ),
    ).not.toThrow();
  });

  it.each([-32602, -32600, -32000, undefined])(
    "rethrows a rejected control (code %s) with its code and redacted diagnostics",
    (code) => {
      const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
      let thrown: unknown;
      try {
        ignoreMissingControlMethod(
          "fx",
          "set_config_option",
          new JsonRpcResponseError(`unknown model, Authorization: Bearer ${secret}`, code),
        );
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(JsonRpcResponseError);
      expect((thrown as JsonRpcResponseError).code).toBe(code);
      expect((thrown as Error).message).toContain("fx set_config_option rejected: unknown model");
      expect((thrown as Error).message).not.toContain(secret);
      expect(JSON.stringify(debug.mock.calls)).not.toContain(secret);
    },
  );

  it("rethrows transport errors untouched", () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const timeout = new Error("request timed out");
    expect(() => ignoreMissingControlMethod("grok", "set_model", timeout)).toThrow(timeout);
    const odd = new Error("something unexpected");
    expect(() => ignoreMissingControlMethod("grok", "set_model", odd)).toThrow(odd);
  });

  it("tolerates an answered rejection of a probe but not a transport failure", () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    expect(() =>
      ignoreMissingControlMethod(
        "fx",
        "set_config_option",
        new JsonRpcResponseError("unknown config option", -32602),
        { probe: true },
      ),
    ).not.toThrow();
    const closed = new Error("pipe closed");
    expect(() =>
      ignoreMissingControlMethod("fx", "set_config_option", closed, { probe: true }),
    ).toThrow(closed);
  });
});
