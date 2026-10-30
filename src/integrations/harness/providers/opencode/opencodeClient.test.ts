import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  harnessHttp: vi.fn(),
  closeHarnessSse: vi.fn(),
  openHarnessSse: vi.fn(),
  watchSse: vi.fn(),
  captureHostHarnessHttp: vi.fn(),
  nativeInvoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.nativeInvoke }));

vi.mock("../../core/child", () => ({
  closeHarnessSse: mocks.closeHarnessSse,
  harnessHttp: mocks.harnessHttp,
  openHarnessSse: mocks.openHarnessSse,
  watchSse: mocks.watchSse,
  captureHostHarnessHttp: mocks.captureHostHarnessHttp,
}));

import { OpenCodeClient } from "./opencodeClient";
import type { HostRunHandle, HostRunBinding } from "../../core/hostRun";
import type { HarnessHttpInput, HostHarnessHttpSource } from "../../core/child";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function hostHttpFixture() {
  // Actual Core captured dispatcher under the existing child mock seam. The
  // authority below is controlled protocol evidence, not a real Host grant.
  const core = await vi.importActual<typeof import("../../core/child")>("../../core/child");
  mocks.captureHostHarnessHttp.mockReset().mockImplementation(core.captureHostHarnessHttp);
  mocks.harnessHttp.mockReset();
  mocks.nativeInvoke.mockReset();
  type Origin = { live: boolean; marker: object };
  const origins = new Map<string, Origin>();
  origins.set("http://127.0.0.1:4096", { live: true, marker: {} });
  const runs = new WeakMap<HostRunHandle, { open: boolean }>();
  const bindings = new WeakMap<
    HostRunBinding,
    { run: HostRunHandle; origin: Origin; source: HostHarnessHttpSource }
  >();
  const requests: Array<HarnessHttpInput & { hostRun: HostRunHandle; binding: HostRunBinding }> =
    [];
  const unknown: typeof requests = [];
  let beforeBind: (() => Promise<void>) | undefined;
  let respond: (
    input: HarnessHttpInput,
  ) => Promise<{ status: number; body: string }> = async () => ({ status: 204, body: "" });
  let pending = 0;
  const mint = () => {
    const run = Object.freeze({}) as HostRunHandle;
    runs.set(run, { open: true });
    return run;
  };
  const invoke = vi.fn();
  invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    if (command === "harness_bind_http_host_run") {
      const run = args.hostRun as HostRunHandle;
      const source = args.httpSource as HostHarnessHttpSource;
      // Capture this original before any authority/preparation await.
      const origin = origins.get(new URL(source.baseUrl).origin);
      if (!origin || source.directory !== "/repo" || !runs.has(run))
        throw new Error("Foreign original HTTP source");
      await beforeBind?.();
      if (!origin.live) throw new Error("Original HTTP origin retired");
      const binding = Object.freeze({}) as HostRunBinding;
      bindings.set(binding, { run, origin, source });
      return binding;
    }
    if (command !== "harness_http_host_run")
      throw new Error(`Unexpected raw/Native command ${command}`);
    const run = args.hostRun as HostRunHandle;
    const original = bindings.get(args.binding as HostRunBinding);
    if (!original || original.run !== run || !runs.get(run)?.open || !original.origin.live)
      throw new Error("Original HTTP run is closed");
    const input = args as HarnessHttpInput & { hostRun: HostRunHandle; binding: HostRunBinding };
    const url = new URL(input.url);
    const session = /^\/(?:api\/)?session\/([^/]+)/.exec(url.pathname)?.[1];
    if (
      url.origin !== new URL(original.source.baseUrl).origin ||
      url.searchParams.get("directory") !== original.source.directory ||
      (original.source.providerSessionId &&
        session &&
        decodeURIComponent(session) !== original.source.providerSessionId)
    )
      throw new Error("Original HTTP target changed");
    requests.push(input);
    pending++;
    try {
      return await respond(input);
    } catch (error) {
      runs.get(run)!.open = false;
      unknown.push(input);
      throw error;
    } finally {
      pending--;
    }
  });
  core.configureChildBackend({ invoke, listen: async () => () => {} });
  return {
    core,
    invoke,
    mint,
    requests,
    unknown,
    close: (run: HostRunHandle) => {
      runs.get(run)!.open = false;
    },
    pending: () => pending,
    setResponse: (next: typeof respond) => {
      respond = next;
    },
    holdBind: (work: () => Promise<void>) => {
      beforeBind = work;
    },
    recycle: () => {
      origins.get("http://127.0.0.1:4096")!.live = false;
      origins.set("http://127.0.0.1:4096", { live: true, marker: {} });
    },
  };
}

describe("original OpenCode Host HTTP views (controlled Host authority)", () => {
  it.each([false, true])(
    "uses captured control for the actual fork after normal close (cleanup fails: %s)",
    async (cleanupFails) => {
      const f = await hostHttpFixture();
      const normal = f.mint();
      const control = f.mint();
      const client = new OpenCodeClient("http://127.0.0.1:4096", "/repo", "v2");
      const view = client.withHostRun(normal);
      f.setResponse(async (input) => {
        if (new URL(input.url).pathname.endsWith("/fork")) {
          f.close(normal);
          if (cleanupFails) f.close(control);
          return {
            status: 200,
            body: JSON.stringify({ data: { id: "actual-fork", location: { directory: "/old" } } }),
          };
        }
        return { status: 204, body: "" };
      });
      const cleanup = vi.fn((id: string) => client.withHostRun(control, id).deleteSession(id));
      const failure = await view.forkSession("original", "/repo", cleanup).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(cleanupFails ? AggregateError : Error);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(cleanup).toHaveBeenCalledWith("actual-fork");
      if (cleanupFails) expect((failure as AggregateError).errors).toHaveLength(2);
      else {
        expect(f.requests.at(-1)?.hostRun).toBe(control);
        expect(new URL(f.requests.at(-1)!.url).pathname).toBe("/api/session/actual-fork");
        expect(f.requests.at(-1)?.method).toBe("DELETE");
      }
      expect(f.requests.filter((input) => input.hostRun === normal)).toHaveLength(1);
      expect(mocks.harnessHttp).not.toHaveBeenCalled();
      expect(mocks.nativeInvoke).not.toHaveBeenCalled();
    },
  );

  it.each(["v1", "v2"] as const)(
    "keeps late A on its original %s source and permits B's own request",
    async (generation) => {
      const f = await hostHttpFixture();
      const runA = f.mint();
      const runB = f.mint();
      const client = new OpenCodeClient("http://127.0.0.1:4096", "/repo", generation);
      const a = client.withHostRun(runA, "original");
      const b = client.withHostRun(runB, "original");
      expect(Object.isFrozen(a)).toBe(true);
      expect(client.withHostRun(runA, "original")).toBe(a);
      const modelReply = deferred<{ status: number; body: string }>();
      f.setResponse(async (input) =>
        new URL(input.url).pathname.endsWith(generation === "v2" ? "/model" : "/message")
          ? modelReply.promise
          : { status: 204, body: "" },
      );
      const original = {
        sessionID: "original",
        model: { providerID: "one", modelID: "A" },
        parts: [{ type: "text" as const, text: "exact A\r\nbody" }],
      };
      const first = a.prompt(original);
      const firstOutcome = first.then(
        () => undefined,
        (error: unknown) => error,
      );
      await vi.waitFor(() => expect(f.pending()).toBe(1));
      original.sessionID = "replacement";
      original.parts[0].text = "B must not replace A";
      f.close(runA);
      f.setResponse(async () => ({ status: 204, body: "" }));
      await b.updateSession("original", { title: "B" });
      modelReply.resolve({ status: 204, body: "" });
      if (generation === "v2") expect(await firstOutcome).toBeInstanceOf(Error);
      else expect(await firstOutcome).toBeUndefined();
      await expect(a.updateSession("original", { title: "late A" })).rejects.toThrow("closed");
      expect(f.requests.every((input) => !input.url.includes("replacement"))).toBe(true);
      if (generation === "v1")
        expect(f.requests.find((input) => input.body?.includes("exact A"))?.body).toContain(
          "exact A\\r\\nbody",
        );
      else {
        expect(f.requests[0].body).toContain('"id":"A"');
        expect(f.requests.some((input) => new URL(input.url).pathname.endsWith("/generate"))).toBe(
          false,
        );
      }
      expect(f.requests.at(-1)?.hostRun).toBe(runB);
      expect(mocks.harnessHttp).not.toHaveBeenCalled();
      expect(mocks.nativeInvoke).not.toHaveBeenCalled();
    },
  );

  it("retains captured connection/backend and refuses foreign URL, cwd and provider sessions", async () => {
    const f = await hostHttpFixture();
    const run = f.mint();
    const client = new OpenCodeClient("http://127.0.0.1:4096", "/repo");
    const source = client.withHostRun(run, "original");
    Object.assign(client as unknown as { baseUrl: string; directory: string }, {
      baseUrl: "http://127.0.0.1:4999",
      directory: "/foreign",
    });
    expect(client.withHostRun(run, "original")).toBe(source);
    const fresh = client.withHostRun(f.mint(), "original");
    await fresh.updateSession("original", { title: "fresh source from captured connection" });
    const replacement = vi.fn(async () => {
      throw new Error("New backend is not A");
    });
    f.core.configureChildBackend({ invoke: replacement, listen: async () => () => {} });
    await source.updateSession("original", { title: "A" });
    await expect(source.updateSession("replacement", {})).rejects.toThrow(
      "different original OpenCode provider session",
    );
    expect(f.requests[0].url).toContain("4096/session/original?directory=%2Frepo");
    expect(replacement).not.toHaveBeenCalled();
    f.core.configureChildBackend({ invoke: f.invoke, listen: async () => () => {} });
    await expect(
      new OpenCodeClient("http://127.0.0.1:4999", "/repo")
        .withHostRun(run, "original")
        .getSession("original"),
    ).rejects.toThrow("Foreign original HTTP source");
    await expect(
      new OpenCodeClient("http://127.0.0.1:4096", "/foreign")
        .withHostRun(run, "original")
        .getSession("original"),
    ).rejects.toThrow("Foreign original HTTP source");
    expect(f.requests).toHaveLength(2);
    expect(mocks.harnessHttp).not.toHaveBeenCalled();
  });

  it("captures the original same-port origin before a held bind and never adopts its replacement", async () => {
    const f = await hostHttpFixture();
    const gate = deferred<void>();
    f.holdBind(() => gate.promise);
    const client = new OpenCodeClient("http://127.0.0.1:4096", "/repo");
    const run = f.mint();
    const view = client.withHostRun(run, "original");
    expect(f.invoke).toHaveBeenCalledTimes(1);
    expect(client.withHostRun(run, "original")).toBe(view);
    const request = view.updateSession("original", {});
    const refused = expect(request).rejects.toThrow("Original HTTP origin retired");
    f.recycle();
    gate.resolve();
    await refused;
    await expect(view.updateSession("original", {})).rejects.toThrow(
      "Original HTTP origin retired",
    );
    expect(
      f.invoke.mock.calls.filter(([command]) => command === "harness_bind_http_host_run"),
    ).toHaveLength(1);
    expect(f.requests).toHaveLength(0);
    expect(mocks.harnessHttp).not.toHaveBeenCalled();
  });

  it("keeps the true request pending and preserves the exact unknown request without replay", async () => {
    const f = await hostHttpFixture();
    const run = f.mint();
    const client = new OpenCodeClient("http://127.0.0.1:4096", "/repo");
    const view = client.withHostRun(run, "original");
    const body = deferred<{ status: number; body: string }>();
    f.setResponse(() => body.promise);
    const first = view.updateSession("original", { title: "exact\r\nrequest" });
    const rejection = expect(first).rejects.toThrow("connection lost after request");
    await vi.waitFor(() => expect(f.pending()).toBe(1));
    expect(client.withHostRun(run, "original")).toBe(view);
    expect(f.requests).toHaveLength(1);
    body.reject(new Error("connection lost after request"));
    await rejection;
    expect(f.unknown).toHaveLength(1);
    expect(f.unknown[0].body).toBe(JSON.stringify({ title: "exact\r\nrequest" }));
    await expect(view.updateSession("original", {})).rejects.toThrow("closed");
    expect(f.requests).toHaveLength(1);
    expect(mocks.harnessHttp).not.toHaveBeenCalled();
  });
});

describe("OpenCodeClient.summarizeSession", () => {
  beforeEach(() => {
    mocks.harnessHttp.mockReset();
    mocks.harnessHttp.mockResolvedValue({ status: 200, body: "true" });
    mocks.openHarnessSse.mockReset();
    mocks.openHarnessSse.mockResolvedValue(undefined);
    mocks.watchSse.mockReset();
  });

  it("calls the native session summarize endpoint with the selected model", async () => {
    const client = new OpenCodeClient("http://127.0.0.1:4096", "/repo");

    await client.summarizeSession("session/a", {
      providerID: "openai",
      modelID: "gpt-5.4",
    });

    expect(mocks.harnessHttp).toHaveBeenCalledWith({
      url: "http://127.0.0.1:4096/session/session%2Fa/summarize?directory=%2Frepo",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-opencode-directory": "%2Frepo",
      },
      body: JSON.stringify({ providerID: "openai", modelID: "gpt-5.4" }),
      timeoutMs: 30 * 60_000,
    });
  });
});

describe("OpenCodeClient v2", () => {
  beforeEach(() => {
    mocks.harnessHttp.mockReset();
    mocks.harnessHttp.mockResolvedValue({ status: 204, body: "" });
    mocks.openHarnessSse.mockReset();
    mocks.openHarnessSse.mockResolvedValue(undefined);
    mocks.watchSse.mockReset();
  });

  it("deletes throwaway sessions in both server generations", async () => {
    const v2 = new OpenCodeClient("http://127.0.0.1:4096", "/repo", "v2");
    await v2.deleteSession("ses_1");
    expect(mocks.harnessHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        url: "http://127.0.0.1:4096/api/session/ses_1?directory=%2Frepo",
      }),
    );

    mocks.harnessHttp.mockClear();
    const v1 = new OpenCodeClient("http://127.0.0.1:4096", "/repo", "v1");
    await v1.deleteSession("ses_1");
    expect(mocks.harnessHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        url: "http://127.0.0.1:4096/session/ses_1?directory=%2Frepo",
      }),
    );
  });

  it("creates sessions with a location and v2 permission rules", async () => {
    mocks.harnessHttp.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({ data: { id: "ses_1" } }),
    });
    const client = new OpenCodeClient("http://127.0.0.1:4096", "/repo", "v2");

    await expect(
      client.createSession({
        permission: [{ permission: "*", pattern: "*", action: "ask" }],
      }),
    ).resolves.toEqual({ id: "ses_1" });
    expect(mocks.harnessHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "http://127.0.0.1:4096/api/session?directory=%2Frepo",
        body: JSON.stringify({
          location: { directory: "/repo" },
          permissions: [{ action: "*", resource: "*", effect: "ask" }],
        }),
      }),
    );
  });

  it("authenticates background service requests", async () => {
    mocks.harnessHttp.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({ data: [] }),
    });
    const client = new OpenCodeClient("http://127.0.0.1:4096", "/repo", "v2", "secret");

    await client.listModels();

    expect(mocks.harnessHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${btoa("opencode:secret")}`,
        }),
      }),
    );
  });

  it("can request the global v2 catalog without a directory context", async () => {
    mocks.harnessHttp.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({ data: [] }),
    });
    const client = new OpenCodeClient("http://127.0.0.1:4096", "", "v2", "secret");

    await client.listModels();

    expect(mocks.harnessHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://127.0.0.1:4096/api/model",
        headers: {
          Authorization: `Basic ${btoa("opencode:secret")}`,
        },
      }),
    );
  });

  it("sets model and agent before queueing a prompt", async () => {
    const client = new OpenCodeClient("http://127.0.0.1:4096", "/repo", "v2");

    await client.promptAsync({
      sessionID: "ses_1",
      model: { providerID: "openai", modelID: "gpt-5.4" },
      agent: "build",
      variant: "high",
      parts: [
        { type: "text", text: "Fix it" },
        {
          type: "file",
          mime: "image/png",
          filename: "bug.png",
          url: "data:image/png;base64,YWJj",
        },
      ],
    });

    expect(
      mocks.harnessHttp.mock.calls.map(([request]) => ({
        path: new URL(request.url).pathname,
        body: request.body ? JSON.parse(request.body) : undefined,
      })),
    ).toEqual([
      {
        path: "/api/session/ses_1/model",
        body: {
          model: {
            providerID: "openai",
            id: "gpt-5.4",
            variant: "high",
          },
        },
      },
      {
        path: "/api/session/ses_1/agent",
        body: { agent: "build" },
      },
      {
        path: "/api/session/ses_1/prompt",
        body: {
          text: "Fix it",
          files: [{ uri: "data:image/png;base64,YWJj", name: "bug.png" }],
          delivery: "queue",
        },
      },
    ]);

    await client.promptAsync({
      sessionID: "ses_1",
      model: { providerID: "openai", modelID: "gpt-5.4" },
      agent: "build",
      variant: "high",
      parts: [{ type: "text", text: "Continue" }],
    });
    expect(mocks.harnessHttp).toHaveBeenCalledTimes(4);
    expect(new URL(mocks.harnessHttp.mock.calls[3]![0].url).pathname).toBe(
      "/api/session/ses_1/prompt",
    );
  });

  it("normalizes v2 permission events and routes replies through the session", async () => {
    let receive: ((data: string) => void) | undefined;
    mocks.watchSse.mockImplementation((_id: string, callback: (data: string) => void) => {
      receive = callback;
    });
    const client = new OpenCodeClient("http://127.0.0.1:4096", "/repo", "v2");
    const events: Record<string, unknown>[] = [];
    await client.subscribeEvents("thread", (event) => events.push(event));

    receive?.(
      JSON.stringify({
        id: "evt_1",
        type: "permission.asked",
        data: {
          id: "per_1",
          sessionID: "ses_1",
          action: "bash",
          resources: ["npm test"],
        },
      }),
    );
    expect(events[0]).toMatchObject({
      type: "permission.asked",
      properties: {
        id: "per_1",
        sessionID: "ses_1",
        permission: "bash",
        patterns: ["npm test"],
      },
    });

    await client.replyPermission("per_1", "once");
    expect(mocks.harnessHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "http://127.0.0.1:4096/api/session/ses_1/permission/per_1/reply?directory=%2Frepo",
        body: JSON.stringify({ decision: "once" }),
      }),
    );
  });

  it("maps v2 forms onto questions and sends keyed answers", async () => {
    let receive: ((data: string) => void) | undefined;
    mocks.watchSse.mockImplementation((_id: string, callback: (data: string) => void) => {
      receive = callback;
    });
    const client = new OpenCodeClient("http://127.0.0.1:4096", "/repo", "v2");
    const events: Record<string, unknown>[] = [];
    await client.subscribeEvents("thread", (event) => events.push(event));
    receive?.(
      JSON.stringify({
        type: "form.created",
        data: {
          form: {
            id: "frm_1",
            sessionID: "ses_1",
            fields: [
              {
                key: "strategy",
                type: "multiselect",
                prompt: "Choose strategies",
                options: [{ label: "Fast" }, { label: "Safe" }],
              },
            ],
          },
        },
      }),
    );

    expect(events[0]).toMatchObject({
      type: "question.asked",
      properties: {
        id: "frm_1",
        sessionID: "ses_1",
        questions: [
          {
            id: "strategy",
            question: "Choose strategies",
            multiple: true,
          },
        ],
      },
    });
    await client.replyQuestion("frm_1", [["Fast", "Safe"]]);
    expect(mocks.harnessHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "http://127.0.0.1:4096/api/session/ses_1/form/frm_1/reply?directory=%2Frepo",
        body: JSON.stringify({
          answer: { strategy: ["Fast", "Safe"] },
        }),
      }),
    );
  });

  it("always answers multiselect fields with a list, even for zero or one choice", async () => {
    let receive: ((data: string) => void) | undefined;
    mocks.watchSse.mockImplementation((_id: string, callback: (data: string) => void) => {
      receive = callback;
    });
    const client = new OpenCodeClient("http://127.0.0.1:4096", "/repo", "v2");
    await client.subscribeEvents("thread", () => undefined);
    const sendForm = (id: string) =>
      receive?.(
        JSON.stringify({
          type: "form.created",
          data: {
            form: {
              id,
              sessionID: "ses_1",
              fields: [
                {
                  key: "strategy",
                  type: "multiselect",
                  options: [
                    { label: "Fast", value: "fast" },
                    { label: "Safe", value: "safe" },
                  ],
                },
                {
                  key: "mode",
                  type: "select",
                  options: [{ label: "Quick" }, { label: "Deep" }],
                },
              ],
            },
          },
        }),
      );
    sendForm("frm_1");
    sendForm("frm_2");

    await client.replyQuestion("frm_1", [["Fast"], ["Quick"]]);
    await client.replyQuestion("frm_2", [[], ["Deep"]]);
    const bodies = mocks.harnessHttp.mock.calls.map(([input]) => input.body);
    expect(bodies.at(-2)).toBe(JSON.stringify({ answer: { strategy: ["fast"], mode: "Quick" } }));
    expect(bodies.at(-1)).toBe(JSON.stringify({ answer: { strategy: [], mode: "Deep" } }));
  });

  it("answers boolean form fields only on exact yes/true", async () => {
    let receive: ((data: string) => void) | undefined;
    mocks.watchSse.mockImplementation((_id: string, callback: (data: string) => void) => {
      receive = callback;
    });
    const client = new OpenCodeClient("http://127.0.0.1:4096", "/repo", "v2");
    await client.subscribeEvents("thread", () => undefined);
    const sendForm = (id: string) =>
      receive?.(
        JSON.stringify({
          type: "form.created",
          data: {
            form: {
              id,
              sessionID: "ses_1",
              fields: [{ key: "confirm", type: "boolean" }],
            },
          },
        }),
      );
    sendForm("frm_1");
    sendForm("frm_2");
    sendForm("frm_3");

    await client.replyQuestion("frm_1", [["yesterday"]]);
    await client.replyQuestion("frm_2", [["not true"]]);
    await client.replyQuestion("frm_3", [[" yes "]]);
    const bodies = mocks.harnessHttp.mock.calls.map(([input]) => input.body);
    expect(bodies.at(-3)).toBe(JSON.stringify({ answer: { confirm: false } }));
    expect(bodies.at(-2)).toBe(JSON.stringify({ answer: { confirm: false } }));
    expect(bodies.at(-1)).toBe(JSON.stringify({ answer: { confirm: true } }));
  });

  it("leaves blank number fields unanswered and passes non-numbers through", async () => {
    let receive: ((data: string) => void) | undefined;
    mocks.watchSse.mockImplementation((_id: string, callback: (data: string) => void) => {
      receive = callback;
    });
    const client = new OpenCodeClient("http://127.0.0.1:4096", "/repo", "v2");
    await client.subscribeEvents("thread", () => undefined);
    const sendForm = (id: string) =>
      receive?.(
        JSON.stringify({
          type: "form.created",
          data: {
            form: {
              id,
              sessionID: "ses_1",
              fields: [
                { key: "count", type: "integer" },
                { key: "ratio", type: "number" },
              ],
            },
          },
        }),
      );
    sendForm("frm_1");
    sendForm("frm_2");

    await client.replyQuestion("frm_1", [[" 3 "], []]);
    await client.replyQuestion("frm_2", [[""], ["~0.5"]]);
    const bodies = mocks.harnessHttp.mock.calls.map(([input]) => input.body);
    expect(bodies.at(-2)).toBe(JSON.stringify({ answer: { count: 3 } }));
    expect(bodies.at(-1)).toBe(JSON.stringify({ answer: { ratio: "~0.5" } }));
  });
});

// This HTTP/SSE protocol fixture proves that original cleanup failures remain
// visible to the source-owned ledger, not a physical retirement/provider ACK.
it.each(["v1", "v2"] as const)(
  "%s preserves abort/delete/SSE close rejection for original cleanup",
  async (generation) => {
    const failure = new Error("Original remote cleanup remains unknown");
    const client = new OpenCodeClient("http://127.0.0.1:4096", "/original", generation);
    mocks.harnessHttp.mockRejectedValueOnce(failure);
    await expect(client.abortSession("original/session")).rejects.toBe(failure);
    mocks.harnessHttp.mockRejectedValueOnce(failure);
    await expect(client.deleteSession("original/session")).rejects.toBe(failure);
    mocks.closeHarnessSse.mockRejectedValueOnce(failure);
    await expect(client.closeEvents("original-wire-owner")).rejects.toBe(failure);
    expect(mocks.closeHarnessSse).toHaveBeenCalledWith("original-wire-owner");
  },
);
