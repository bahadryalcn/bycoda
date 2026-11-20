import { describe, expect, it } from "vitest";
import {
  HOST_HTTP_MAX_RESPONSE_BYTES,
  HOST_RESULT_TOO_LARGE_CODE,
} from "../../src/shared/model/host-contracts/response-limit";
import { assertResponseFits, HostResultTooLargeError } from "./http-result-limit";

const envelope = (result: string) => `{"result":${JSON.stringify(result)}}`;
// `{"result":""}` around the string: 13 bytes the value itself does not own.
const ENVELOPE_BYTES = Buffer.byteLength(envelope(""));

describe("assertResponseFits", () => {
  it("shares the 16 MiB limit with the desktop and the phone", () => {
    expect(HOST_HTTP_MAX_RESPONSE_BYTES).toBe(16 * 1024 * 1024);
  });

  it("accepts a body of exactly the limit and refuses one byte more, envelope included", () => {
    const fits = envelope("x".repeat(HOST_HTTP_MAX_RESPONSE_BYTES - ENVELOPE_BYTES));
    expect(Buffer.byteLength(fits)).toBe(HOST_HTTP_MAX_RESPONSE_BYTES);
    expect(() => assertResponseFits(fits, true)).not.toThrow();
    expect(() => assertResponseFits(`${fits} `, true)).toThrow(HostResultTooLargeError);
  });

  it("counts UTF-8 bytes, not UTF-16 units", () => {
    // 3 bytes per character: well under the limit in characters, over it in bytes.
    const body = envelope("€".repeat(Math.ceil(HOST_HTTP_MAX_RESPONSE_BYTES / 3)));
    expect(body.length).toBeLessThan(HOST_HTTP_MAX_RESPONSE_BYTES);
    expect(() => assertResponseFits(body, false)).toThrow(HostResultTooLargeError);
  });

  it("reports an effectful method as an unknown outcome with the typed code", () => {
    const body = envelope("x".repeat(64));
    let caught: unknown;
    try {
      assertResponseFits(body, true, 32);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HostResultTooLargeError);
    expect(caught).toMatchObject({
      code: HOST_RESULT_TOO_LARGE_CODE,
      effect: true,
      maxBytes: 32,
      bytes: Buffer.byteLength(body),
    });
    expect((caught as Error).message).toContain("narrow the request");
  });

  it("marks a query as having no effect to recover", () => {
    expect(() => assertResponseFits(envelope("x".repeat(64)), false, 32)).toThrow(
      expect.objectContaining({ effect: false }),
    );
  });
});
