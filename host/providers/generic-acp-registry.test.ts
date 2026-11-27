import { afterEach, describe, expect, it, vi } from "vitest";
import { GenericAcpService } from "./generic-acp";

const registryBody = JSON.stringify({
  agents: [
    {
      id: "one",
      name: "One",
      version: "1.0.0",
      distribution: { npx: { package: "test-agent@1.0.0" } },
    },
  ],
});

function stubFetch(...responses: (() => Response | Promise<Response>)[]) {
  const fetchMock = vi.fn(() => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected registry fetch");
    return Promise.resolve(next());
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ok = () => new Response(registryBody);
const failing = () => new Response("", { status: 503 });

describe("ACP registry fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shares one in-flight fetch between concurrent callers", async () => {
    const fetchMock = stubFetch(ok);
    const service = new GenericAcpService("unused-registry-dedupe-directory");
    const [first, second] = await Promise.all([service.registry(), service.registry()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.map((entry) => entry.id)).toEqual(["one"]);
    expect(second).toBe(first);
  });

  it("does not refetch a failed registry during its backoff, then retries", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetchMock = stubFetch(failing, ok);
    const service = new GenericAcpService("unused-registry-backoff-directory");
    await expect(service.registry()).rejects.toThrow("ACP registry returned 503");
    await expect(service.registry()).rejects.toThrow("ACP registry returned 503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 30_001;
    await expect(service.registry()).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("serves the last good list while a refresh failure is backing off", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetchMock = stubFetch(ok, failing);
    const service = new GenericAcpService("unused-registry-stale-directory");
    const cached = await service.registry();
    now += 3_600_001;
    await expect(service.registry()).resolves.toBe(cached);
    await expect(service.registry()).resolves.toBe(cached);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lets an explicit refresh bypass the failure backoff", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const fetchMock = stubFetch(failing, ok);
    const service = new GenericAcpService("unused-registry-refresh-directory");
    await expect(service.registry()).rejects.toThrow("ACP registry returned 503");
    await expect(service.registry(true)).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lets one caller stop waiting without cancelling the shared load", async () => {
    let finish!: () => void;
    const fetchMock = stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          finish = () => resolve(ok());
        }),
    );
    const service = new GenericAcpService("unused-registry-abort-directory");
    const controller = new AbortController();
    const cancelled = service.registry(false, controller.signal);
    const kept = service.registry();
    controller.abort();
    await expect(cancelled).rejects.toThrow(/abort/i);
    finish();
    await expect(kept).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
