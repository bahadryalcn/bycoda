import { expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { canonicalControlOrigin, WebControl } from "./web-control";

const request = (headers: Record<string, string>, url = "/control/rpc") =>
  ({ method: "POST", url, headers }) as IncomingMessage;
it("allows only the configured same-origin web route; native RPC stays separate", () => {
  const control = new WebControl("https://host.example:443");
  const headers = {
    origin: "https://host.example",
    host: "host.example",
    "content-type": "application/json",
  };
  expect(control.acceptsRpc(request(headers))).toBe(true);
  expect(control.acceptsRpc(request(headers, "/rpc"))).toBe(false);
  expect(control.acceptsRpc(request({ ...headers, origin: "https://evil.example" }))).toBe(false);
  expect(control.acceptsRpc(request({ ...headers, host: "evil.example" }))).toBe(false);
  expect(control.acceptsRpc(request({ ...headers, "sec-fetch-site": "cross-site" }))).toBe(false);
  expect(control.acceptsRpc(request({ ...headers, "content-type": "text/plain" }))).toBe(false);
});
it("rejects credential URLs, paths and cleartext remote access", () => {
  expect(() => canonicalControlOrigin("http://192.168.1.5:3776")).toThrow("HTTPS");
  expect(() => canonicalControlOrigin("https://user:secret@host.example")).toThrow();
  expect(() => canonicalControlOrigin("https://host.example/control")).toThrow();
  expect(canonicalControlOrigin("http://127.0.0.1:3776")).toBe("http://127.0.0.1:3776");
});
