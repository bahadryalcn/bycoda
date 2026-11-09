import { describe, expect, it, vi } from "vitest";
import { HostPersistenceStatusSchema } from "../../../src/shared/model/host-contracts/persistence";
import { createHostPersistenceService } from "./persistence-service";

const context = () => ({ authorized: vi.fn(async () => true) });
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Host persistence domain", () => {
  it("accepts only canonical sanitized status and strict empty params", async () => {
    const status = vi.fn(() => ({ state: "ready" as const }));
    const recover = vi.fn(async () => {});
    const service = createHostPersistenceService({ status, recover });
    await expect(service.status({}, context())).resolves.toEqual({ state: "ready" });
    await expect(service.status({ extension: true }, context())).rejects.toThrow();
    expect(status).toHaveBeenCalledTimes(1);
    expect(HostPersistenceStatusSchema.safeParse({ state: "ready", path: "private" }).success).toBe(
      false,
    );
    expect(HostPersistenceStatusSchema.safeParse({ state: "unknown" }).success).toBe(false);
    await expect(service.status({ extension: true }, context(), { legacy: true })).resolves.toEqual(
      { state: "ready" },
    );
    await expect(service.status([], context())).rejects.toThrow();
  });

  it("checks authorization before storage access and after delayed status", async () => {
    const pending = gate();
    const status = vi.fn(async () => {
      await pending.promise;
      return { state: "ready" as const };
    });
    const service = createHostPersistenceService({ status, recover: vi.fn() });
    const denied = { authorized: async () => false };
    await expect(service.status({}, denied)).rejects.toThrow("revoked");
    expect(status).not.toHaveBeenCalled();
    const request = context();
    const result = service.status({}, request);
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(1));
    request.authorized.mockResolvedValue(false);
    pending.resolve();
    await expect(result).rejects.toThrow("revoked");
  });

  it("holds single-flight through cancellation until the actual probe settles", async () => {
    const pending = gate();
    const entered = gate();
    let authorize!: () => Promise<boolean>;
    const recover = vi.fn(async (authorized: () => Promise<boolean>) => {
      authorize = authorized;
      entered.resolve();
      await pending.promise;
    });
    const service = createHostPersistenceService({
      status: () => ({ state: "temporarily-blocked", reason: "full" }),
      recover,
    });
    const controller = new AbortController();
    const result = service.recover({}, { ...context(), signal: controller.signal });
    await entered.promise;
    controller.abort();
    await expect(authorize()).rejects.toThrow("cancelled");
    await expect(service.recover({}, context())).rejects.toThrow("already in progress");
    expect(recover).toHaveBeenCalledTimes(1);
    pending.resolve();
    await expect(result).rejects.toThrow("cancelled");
    await service.recover({}, context());
    expect(recover).toHaveBeenCalledTimes(2);
  });

  it("does not disclose recovery results after revocation", async () => {
    const request = context();
    const recover = vi.fn(async (authorized: () => Promise<boolean>) => {
      expect(await authorized()).toBe(true);
      request.authorized.mockResolvedValue(false);
      await expect(authorized()).rejects.toThrow("revoked");
    });
    const service = createHostPersistenceService({ status: () => ({ state: "ready" }), recover });
    await expect(service.recover({}, request)).rejects.toThrow("revoked");
  });

  it("propagates probe failure once and permits an explicit subsequent attempt", async () => {
    const failure = new Error("probe failed");
    const recover = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const service = createHostPersistenceService({
      status: () => ({ state: "temporarily-blocked", reason: "busy" }),
      recover,
    });
    await expect(service.recover({}, context())).rejects.toBe(failure);
    expect(recover).toHaveBeenCalledTimes(1);
    await expect(service.recover({}, context())).resolves.toEqual({
      state: "temporarily-blocked",
      reason: "busy",
    });
    expect(recover).toHaveBeenCalledTimes(2);
  });

  it("never probes permanent damage, unknown health, or an already recovering store", async () => {
    for (const value of [
      { state: "recovery-required", reason: "corrupt" },
      { state: "recovery-required", reason: "worker" },
      { state: "recovering" },
      undefined,
      { state: "unknown" },
    ]) {
      const recover = vi.fn();
      const service = createHostPersistenceService({ status: (() => value) as never, recover });
      await expect(service.recover({}, context())).rejects.toThrow();
      expect(recover).not.toHaveBeenCalled();
    }
  });
});
