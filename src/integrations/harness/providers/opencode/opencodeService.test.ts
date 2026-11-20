import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execChild: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("../../core/child", () => ({
  execChild: mocks.execChild,
  hasHeadlessChildBackend: () => false,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));

vi.mock("../../../../features/providers/model/providerBinaryPaths", () => ({
  runtimeProviderBinaryPath: () => undefined,
}));

import {
  CATALOG_ACQUIRE_TIMEOUT_MS,
  parseOpenCodeServiceUrl,
  releaseOwnedOpenCodeForCapability,
  resolveOwnedOpenCodeCatalog,
  resolveOpenCodeV2Service,
  resolveOpenCodeV2ServiceUrl,
} from "./opencodeService";

describe("OpenCode v2 background service", () => {
  beforeEach(() => {
    mocks.execChild.mockReset();
    mocks.invoke.mockReset();
  });

  it("parses only local service URLs", () => {
    expect(parseOpenCodeServiceUrl("http://127.0.0.1:49374\n")).toBe("http://127.0.0.1:49374");
    expect(parseOpenCodeServiceUrl("http://localhost:4096/")).toBe("http://localhost:4096");
    expect(parseOpenCodeServiceUrl("https://example.com:4096")).toBeNull();
  });

  it("uses an existing background service", async () => {
    mocks.execChild.mockResolvedValue("http://127.0.0.1:49374\n");

    await expect(resolveOpenCodeV2ServiceUrl("/opencode", "/repo")).resolves.toBe(
      "http://127.0.0.1:49374",
    );
    expect(mocks.execChild).toHaveBeenCalledOnce();
    expect(mocks.execChild).toHaveBeenCalledWith(
      "/opencode",
      ["service", "status"],
      "/repo",
      "opencode",
      undefined,
      "management",
    );
  });

  it("starts the service when it is not running", async () => {
    mocks.execChild
      .mockRejectedValueOnce(new Error("not running"))
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("http://127.0.0.1:49374");

    await expect(resolveOpenCodeV2ServiceUrl("/opencode", "/repo")).resolves.toBe(
      "http://127.0.0.1:49374",
    );
    expect(mocks.execChild.mock.calls.map(([, args]) => args)).toEqual([
      ["service", "status"],
      ["service", "start"],
      ["service", "status"],
    ]);
  });

  it("loads the service password for authenticated API requests", async () => {
    mocks.execChild
      .mockResolvedValueOnce("http://127.0.0.1:49374\n")
      .mockResolvedValueOnce("secret\n");

    await expect(resolveOpenCodeV2Service("/opencode", "/repo")).resolves.toEqual({
      url: "http://127.0.0.1:49374",
      password: "secret",
    });
    expect(mocks.execChild.mock.calls.map(([, args]) => args)).toEqual([
      ["service", "status"],
      ["service", "get", "password"],
    ]);
  });

  it("retries a failed catalog service with the same operation instead of caching the failure", async () => {
    const acquired: unknown[] = [];
    let failNext = true;
    mocks.invoke.mockImplementation((command: string, args: Record<string, unknown>) => {
      if (command === "canonical_store_page_token") return Promise.resolve("page");
      if (command === "harness_management_grant")
        return Promise.resolve({ token: "grant", routeId: "route" });
      acquired.push(args.operationId);
      if (failNext) {
        failNext = false;
        return Promise.reject(new Error("Background service failed to start"));
      }
      return Promise.resolve({ serviceId: "s", referenceId: "r", endpoint: "http://127.0.0.1:1" });
    });

    await expect(resolveOwnedOpenCodeCatalog("/opencode", "/retry")).rejects.toThrow(
      "Background service failed to start",
    );
    await expect(resolveOwnedOpenCodeCatalog("/opencode", "/retry")).resolves.toMatchObject({
      url: "http://127.0.0.1:1",
    });
    expect(acquired).toHaveLength(2);
    // An unknown outcome may have been accepted natively; the same operation ID
    // lets the native side return that reference instead of leaking it.
    expect(acquired[1]).toBe(acquired[0]);
  });

  describe("catalog acquire timeout", () => {
    const source = { serviceId: "s", referenceId: "r", endpoint: "http://127.0.0.1:2" };

    function stubCatalogInvoke(acquire: (operationId: unknown) => Promise<unknown>) {
      const operationIds: unknown[] = [];
      mocks.invoke.mockImplementation((command: string, args: Record<string, unknown>) => {
        if (command === "canonical_store_page_token") return Promise.resolve("page");
        if (command === "harness_management_grant")
          return Promise.resolve({ token: "grant", routeId: "route" });
        operationIds.push(args.operationId);
        return acquire(args.operationId);
      });
      return operationIds;
    }

    it("fails a hung acquire at the deadline and joins it instead of replaying", async () => {
      vi.useFakeTimers();
      try {
        const hung = Promise.withResolvers<unknown>();
        const operationIds = stubCatalogInvoke(() => hung.promise);

        const first = resolveOwnedOpenCodeCatalog("/opencode", "/timeout-join");
        const firstFailure = expect(first).rejects.toThrow(
          `timed out after ${CATALOG_ACQUIRE_TIMEOUT_MS}ms`,
        );
        await vi.advanceTimersByTimeAsync(CATALOG_ACQUIRE_TIMEOUT_MS);
        await firstFailure;

        // Outcome is unknown: the next call waits on the same native acquire
        // under a fresh deadline and does not issue a second one.
        const second = resolveOwnedOpenCodeCatalog("/opencode", "/timeout-join");
        const secondFailure = expect(second).rejects.toThrow("timed out");
        await vi.advanceTimersByTimeAsync(CATALOG_ACQUIRE_TIMEOUT_MS);
        await secondFailure;
        expect(operationIds).toHaveLength(1);

        // A late success after the deadline is kept, not dropped or re-acquired.
        const third = resolveOwnedOpenCodeCatalog("/opencode", "/timeout-join");
        hung.resolve(source);
        await expect(third).resolves.toMatchObject({
          url: source.endpoint,
          nativeOwnedService: { serviceId: "s", referenceId: "r" },
        });
        await expect(
          resolveOwnedOpenCodeCatalog("/opencode", "/timeout-join"),
        ).resolves.toMatchObject({ url: source.endpoint });
        expect(operationIds).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("retries with the original operation ID after a timed-out acquire later rejects", async () => {
      vi.useFakeTimers();
      try {
        const hung = Promise.withResolvers<unknown>();
        let calls = 0;
        const operationIds = stubCatalogInvoke(() =>
          ++calls === 1 ? hung.promise : Promise.resolve(source),
        );

        const timedOut = resolveOwnedOpenCodeCatalog("/opencode", "/timeout-reject");
        const failure = expect(timedOut).rejects.toThrow("timed out");
        await vi.advanceTimersByTimeAsync(CATALOG_ACQUIRE_TIMEOUT_MS);
        await failure;

        hung.reject(new Error("Background service failed to start"));
        await vi.advanceTimersByTimeAsync(0);

        await expect(
          resolveOwnedOpenCodeCatalog("/opencode", "/timeout-reject"),
        ).resolves.toMatchObject({ url: source.endpoint });
        expect(operationIds).toHaveLength(2);
        expect(operationIds[1]).toBe(operationIds[0]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not arm a deadline for an already settled acquire", async () => {
      const operationIds = stubCatalogInvoke(() => Promise.resolve(source));
      const settled = await resolveOwnedOpenCodeCatalog("/opencode", "/timeout-settled");

      await expect(resolveOwnedOpenCodeCatalog("/opencode", "/timeout-settled")).resolves.toBe(
        settled,
      );
      expect(operationIds).toHaveLength(1);
    });
  });

  it("coalesces session acquires and retries a rejection with the original operation ID", async () => {
    const capability = { shellId: "session", pageToken: "page", operationId: "claim" };
    const source = { serviceId: "service", referenceId: "ref", endpoint: "http://127.0.0.1:4096" };
    mocks.invoke
      .mockRejectedValueOnce(new Error("Service startup failed"))
      .mockResolvedValueOnce(source);
    const acquire = () => resolveOpenCodeV2Service("/opencode", "/repo", capability);

    const first = acquire();
    const concurrent = acquire();
    await Promise.all([
      expect(first).rejects.toThrow("Service startup failed"),
      expect(concurrent).rejects.toThrow("Service startup failed"),
    ]);
    expect(mocks.invoke).toHaveBeenCalledOnce();

    const retried = await acquire();
    expect(retried).toEqual({
      url: source.endpoint,
      nativeOwnedService: { serviceId: source.serviceId, referenceId: source.referenceId },
    });
    await expect(acquire()).resolves.toBe(retried);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      "owned_opencode_acquire",
      expect.objectContaining({
        capability,
        operationId: expect.any(String),
      }),
    );
    expect(mocks.invoke.mock.calls[1]?.[1]).toEqual(mocks.invoke.mock.calls[0]?.[1]);
  });

  it("releases a successful reference after an earlier pending acquire rejects", async () => {
    const capability = { shellId: "session", pageToken: "page", operationId: "claim" };
    const failing = Promise.withResolvers<never>();
    mocks.invoke
      .mockReturnValueOnce(failing.promise)
      .mockResolvedValueOnce({
        serviceId: "service",
        referenceId: "ref",
        endpoint: "http://127.0.0.1:4096",
      })
      .mockResolvedValueOnce(true);

    const failed = resolveOpenCodeV2Service("/opencode", "/bad", capability);
    await resolveOpenCodeV2Service("/opencode", "/good", capability);
    const release = releaseOwnedOpenCodeForCapability(capability);
    const failure = expect(failed).rejects.toThrow("Service startup failed");
    const retirement = expect(release).resolves.toBeUndefined();
    failing.reject(new Error("Service startup failed"));
    await Promise.all([failure, retirement]);

    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    expect(mocks.invoke).toHaveBeenLastCalledWith("owned_opencode_release", {
      serviceId: "service",
      referenceId: "ref",
      pageToken: "page",
      capability,
    });
  });
});
