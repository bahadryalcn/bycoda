import { expect, it, vi } from "vitest";
import { createNativeServicesService } from "./service";
import type { HostDomainContext } from "../context";

it("forwards bounded desktop wait to captured authority and rechecks it", async () => {
  const waitDesktopStatus = vi.fn(async () => ({ revision: "epoch:2" }));
  const authorized = vi.fn(async () => true);
  const signal = new AbortController().signal;
  const context = {
    authorized,
    signal,
    nativeServices: { waitDesktopStatus },
  } as unknown as HostDomainContext;
  const service = createNativeServicesService();
  expect(
    await service.call(
      "native.services.desktop.status.wait",
      { afterRevision: "epoch:1", timeoutMs: 25000 },
      context,
    ),
  ).toEqual({ revision: "epoch:2" });
  expect(waitDesktopStatus).toHaveBeenCalledWith("epoch:1", 25000, signal);
  expect(authorized).toHaveBeenCalledTimes(2);
  await expect(
    service.call(
      "native.services.desktop.status.wait",
      { afterRevision: "epoch:1", timeoutMs: 25001 },
      context,
    ),
  ).rejects.toThrow();
});
