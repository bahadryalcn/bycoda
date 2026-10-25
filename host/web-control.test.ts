import { expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { canonicalControlOrigin, WebControl } from "./web-control";
import { CONTROL_SCRIPT } from "./web-control";
import { createContext, runInContext } from "node:vm";

it("loads session navigation before a held optional model catalog", async () => {
  let release!: (value: unknown) => void;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const elements = new Map<
    string,
    {
      value: string;
      options: unknown[];
      replaceChildren: () => void;
      append: (value: unknown) => void;
    }
  >();
  const element = (id: string) => {
    if (!elements.has(id))
      elements.set(id, {
        value: id === "project" ? "P" : "",
        options: [],
        replaceChildren() {
          this.options = [];
        },
        append(value) {
          this.options.push(value);
        },
      });
    return elements.get(id)!;
  };
  const requests: { method: string; params: Record<string, unknown> }[] = [];
  const context = createContext({
    document: { getElementById: element },
    addEventListener() {},
    clearTimeout,
    setTimeout,
    rpcFixture: async (method: string, params: Record<string, unknown>) => {
      requests.push({ method, params });
      if (method === "models.list") return held;
      if (method === "sessions.list") return [];
      throw new Error(`Unexpected RPC ${method}`);
    },
  });
  runInContext(CONTROL_SCRIPT, context);
  runInContext("token='synthetic';rpc=rpcFixture", context);
  let navigated = false;
  const navigation = runInContext("project()", context).then(() => {
    navigated = true;
  });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    expect(navigated).toBe(true);
    expect(requests).toContainEqual({
      method: "models.list",
      params: { projectId: "P", progressive: true },
    });
    expect(requests).toContainEqual({ method: "sessions.list", params: { projectId: "P" } });
  } finally {
    release({ models: {} });
    await navigation;
  }
});

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
