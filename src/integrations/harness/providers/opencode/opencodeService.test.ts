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
  parseOpenCodeServiceUrl,
  resolveOwnedOpenCodeCatalog,
  resolveOpenCodeV2Service,
  resolveOpenCodeV2ServiceUrl,
} from "./opencodeService";

describe("OpenCode v2 background service", () => {
  beforeEach(() => {
    mocks.execChild.mockReset();
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
});
