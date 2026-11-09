import { describe, expect, it, vi } from "vitest";
import { AdapterFailure } from "./common";
import { assertEndpointAllowed, createFetchTransport, statusFailure } from "./http";

describe("assertEndpointAllowed", () => {
  it("allows HTTPS and loopback HTTP endpoints", () => {
    expect(assertEndpointAllowed("https://api.example.test/v1/systemone").hostname).toBe(
      "api.example.test",
    );
    expect(assertEndpointAllowed("http://127.0.0.1:8767/v1/systemone").port).toBe("8767");
    expect(assertEndpointAllowed("http://localhost:11434/api/systemone").hostname).toBe(
      "localhost",
    );
  });

  it("refuses plain HTTP to a remote host, URL credentials and invalid URLs", () => {
    expect(() => assertEndpointAllowed("http://api.example.test/v1/systemone")).toThrow(
      AdapterFailure,
    );
    expect(() => assertEndpointAllowed("https://user:pass@api.example.test/v1")).toThrow(
      AdapterFailure,
    );
    expect(() => assertEndpointAllowed("not a url")).toThrow(AdapterFailure);
  });
});

describe("statusFailure", () => {
  it("maps statuses to codes and retry rules without copying a body", () => {
    expect(statusFailure(401)).toMatchObject({ code: "auth", retryable: false });
    expect(statusFailure(429)).toMatchObject({ code: "rate_limited", retryable: true });
    expect(statusFailure(503)).toMatchObject({ code: "unavailable", retryable: true });
    expect(statusFailure(422)).toMatchObject({ code: "rejected", retryable: false });
    expect(statusFailure(503).message).not.toMatch(/body|key/i);
  });
});

describe("createFetchTransport.postJson", () => {
  const url = "https://api.example.test/v1/systemone";

  it("posts JSON, refuses redirects and returns the parsed body", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const transport = createFetchTransport({ fetcher: fetcher as unknown as typeof fetch });
    const signal = new AbortController().signal;
    await expect(transport.postJson(url, { a: "b" }, { q: 1 }, signal)).resolves.toEqual({
      ok: true,
    });
    const [calledUrl, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe(url);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.body).toBe(JSON.stringify({ q: 1 }));
  });

  it("maps a non-OK status to a failure", async () => {
    const fetcher = vi.fn(async () => new Response("secret body", { status: 401 }));
    const transport = createFetchTransport({ fetcher: fetcher as unknown as typeof fetch });
    await expect(
      transport.postJson(url, {}, {}, new AbortController().signal),
    ).rejects.toMatchObject({ code: "auth" });
  });

  it("rejects an oversized response and invalid JSON as malformed", async () => {
    const big = new Response("x".repeat(300 * 1024), { status: 200 });
    const transport = createFetchTransport({
      fetcher: vi.fn(async () => big) as unknown as typeof fetch,
    });
    await expect(
      transport.postJson(url, {}, {}, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "malformed",
    });
    const invalid = createFetchTransport({
      fetcher: vi.fn(
        async () => new Response("not json", { status: 200 }),
      ) as unknown as typeof fetch,
    });
    await expect(invalid.postJson(url, {}, {}, new AbortController().signal)).rejects.toMatchObject(
      {
        code: "malformed",
      },
    );
  });

  it("reports a network error as unavailable and an aborted call as timeout", async () => {
    const failing = createFetchTransport({
      fetcher: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    await expect(failing.postJson(url, {}, {}, new AbortController().signal)).rejects.toMatchObject(
      {
        code: "unavailable",
      },
    );
    const controller = new AbortController();
    controller.abort();
    const aborted = createFetchTransport({
      fetcher: vi.fn(async () => {
        throw new DOMException("aborted", "AbortError");
      }) as unknown as typeof fetch,
    });
    await expect(aborted.postJson(url, {}, {}, controller.signal)).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("refuses a plain HTTP remote endpoint before any request", async () => {
    const fetcher = vi.fn();
    const transport = createFetchTransport({ fetcher: fetcher as unknown as typeof fetch });
    await expect(
      transport.postJson("http://api.example.test/v1", {}, {}, new AbortController().signal),
    ).rejects.toMatchObject({ code: "rejected" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
