import { expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { canonicalControlOrigin, WebControl } from "./web-control";
import { CONTROL_SCRIPT } from "./web-control";
import { createContext, runInContext } from "node:vm";
import { webcrypto } from "node:crypto";

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

function approvalPage(capabilities: string[], occurrenceId?: string) {
  type Element = {
    value: string;
    hidden: boolean;
    disabled: boolean;
    textContent: string;
    children: Element[];
    onclick?: () => Promise<void>;
    append: (child: Element) => void;
    replaceChildren: () => void;
  };
  const elements = new Map<string, Element>();
  const createElement = (): Element => ({
    value: "",
    hidden: true,
    disabled: false,
    textContent: "",
    children: [],
    append(child) {
      this.children.push(child);
    },
    replaceChildren() {
      this.children = [];
    },
  });
  const getElementById = (id: string) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id)!;
  };
  const requests: { method: string; params: Record<string, unknown> }[] = [];
  const fixture = {
    runId: "original-run",
    authorityGeneration: 4,
    status: "running",
    session: {
      title: "Original",
      blocks: [{ kind: "tool", text: "permission", approval: { requestId: 7, occurrenceId } }],
    },
  };
  const context = createContext({
    fixture,
    capabilities,
    crypto: webcrypto,
    document: { getElementById, createElement },
    addEventListener() {},
    clearTimeout,
    setTimeout,
    rpcFixture: async (method: string, params: Record<string, unknown>) => {
      requests.push({ method, params });
      return { accepted: true };
    },
  });
  runInContext(CONTROL_SCRIPT, context);
  runInContext(
    "rpc=rpcFixture;environment={capabilities};sessionId='original-session';snapshot=fixture;render()",
    context,
  );
  return {
    context,
    fixture,
    requests,
    getElementById,
    allow: getElementById("transcript").children[0].children[0],
  };
}

it("binds the actual displayed approval button before globals and same-ID source metadata change", async () => {
  const occurrenceId = "12345678-1234-4123-8123-123456789abc";
  const page = approvalPage(["sessions.approvalOccurrence.v1"], occurrenceId);
  page.fixture.session.blocks[0].approval.occurrenceId = "abcdef12-1234-4123-9123-123456789abc";
  runInContext(
    "sessionId='replacement-session';snapshot={runId:'replacement-run',authorityGeneration:9}",
    page.context,
  );
  await page.allow.onclick!();
  expect(page.requests).toHaveLength(1);
  expect(page.requests[0]).toEqual({
    method: "commands.dispatch",
    params: {
      type: "approve",
      sessionId: "original-session",
      runId: "original-run",
      authorityGeneration: 4,
      requestId: 7,
      approvalOccurrenceId: occurrenceId,
      decision: "allow",
      commandId: expect.any(String),
    },
  });
});

it("refuses unsupported and legacy approval controls before RPC without declaring uncertain delivery", async () => {
  for (const [capabilities, occurrenceId, message] of [
    [[], "12345678-1234-4123-8123-123456789abc", "Update the Host"],
    [["sessions.approvalOccurrence.v1"], undefined, "cannot be verified"],
  ] as const) {
    const page = approvalPage([...capabilities], occurrenceId);
    await page.allow.onclick!();
    expect(page.requests).toEqual([]);
    expect(page.getElementById("error").textContent).toContain(message);
    expect(page.getElementById("recover").hidden).toBe(true);
    expect(runInContext("uncertain", page.context)).toBeUndefined();
  }
});

it("refuses a retained web approval button after its authenticated connection changes", async () => {
  const page = approvalPage(
    ["sessions.approvalOccurrence.v1"],
    "12345678-1234-4123-8123-123456789abc",
  );
  runInContext("environment={capabilities:['sessions.approvalOccurrence.v1']}", page.context);
  await page.allow.onclick!();
  expect(page.requests).toEqual([]);
  expect(page.getElementById("error").textContent).toContain("connection changed");
  expect(runInContext("uncertain", page.context)).toBeUndefined();
});

function browserPage() {
  const elements = new Map<string, any>();
  const element = (id: string) => {
    if (!elements.has(id))
      elements.set(id, {
        value: "",
        textContent: "",
        src: "",
        get currentSrc() {
          return this.src;
        },
        naturalWidth: 1600,
        naturalHeight: 900,
        replaceChildren() {},
        removeAttribute(name: string) {
          this[name] = "";
        },
        getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 300 }),
      });
    return elements.get(id);
  };
  const requests: { method: string; params: Record<string, unknown> }[] = [];
  let frameResult: unknown = {
    open: true,
    url: "https://example.test",
    width: 800,
    height: 600,
    data: "frame-one",
    mimeType: "image/jpeg",
    documentId: "document-one",
    navigationId: "view-one",
  };
  const context = createContext({
    document: { getElementById: element },
    addEventListener() {},
    clearTimeout,
    setTimeout,
    rpcFixture: async (method: string, params: Record<string, unknown>) => {
      requests.push({ method, params });
      return method === "browser.frame" ? await frameResult : { open: true };
    },
  });
  runInContext(CONTROL_SCRIPT, context);
  runInContext(
    "token='credential';environment={environmentId:'original'};leaseId='lease';rpc=rpcFixture",
    context,
  );
  return {
    context,
    element,
    requests,
    nextFrame: (result: unknown) => {
      frameResult = result;
    },
  };
}

it("scales clicks using the loaded original frame viewport and sends its document/view identity", async () => {
  const f = browserPage();
  await runInContext("frame()", f.context);
  f.element("frame").onload();
  await f.element("frame").onclick({ target: f.element("frame"), clientX: 210, clientY: 170 });
  expect(f.requests.find((request) => request.method === "browser.input")?.params).toMatchObject({
    kind: "click",
    x: 400,
    y: 300,
    documentId: "document-one",
    navigationId: "view-one",
    leaseId: "lease",
  });
});

it("never clicks an undecoded or old-connection frame and discards late capture responses", async () => {
  const f = browserPage();
  await runInContext("frame()", f.context);
  await f.element("frame").onclick({ clientX: 20, clientY: 30 });
  expect(f.requests.some((request) => request.method === "browser.input")).toBe(false);
  f.element("frame").onload();
  let release!: (value: unknown) => void;
  f.nextFrame(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const pending = runInContext("frame()", f.context);
  runInContext("disconnect()", f.context);
  release({
    width: 1600,
    height: 900,
    data: "late",
    mimeType: "image/jpeg",
    documentId: "late",
    navigationId: "late",
  });
  await expect(pending).rejects.toThrow("connection or control changed");
  expect(f.element("frame").src).toBe("");
  expect(f.requests.some((request) => request.method === "browser.input")).toBe(false);
});
