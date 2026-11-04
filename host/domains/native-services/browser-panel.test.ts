import { expect, it, vi } from "vitest";
import { createNativeServicesService } from "./service";
import type { HostDomainContext } from "../context";

const method = "native.services.assistant.browser.panel";
const input = {
  environmentId: "host", projectId: "project", threadId: "thread",
  projectCwd: "/project", action: "browser.status", input: {}, requestId: "request",
};
function fixture() {
  const browserPanel = vi.fn(async () => ({ mounted: true }));
  const context = {
    authorized: async () => true,
    nativeServices: { browserPanel },
  } as unknown as HostDomainContext;
  return { service: createNativeServicesService(), browserPanel, context };
}

it("dispatches a registered panel request through its authenticated native owner", async () => {
  const f = fixture();
  expect(await f.service.call(method, input, f.context)).toEqual({ mounted: true });
  expect(f.browserPanel).toHaveBeenCalledWith(input);
});

it("preserves bounded Unicode paths and rejects invalid paths before native disclosure", async () => {
  const f = fixture();
  await f.service.call(method, { ...input, projectCwd: "😀".repeat(2048) }, f.context);
  expect(f.browserPanel).toHaveBeenCalledTimes(1);
  for (const projectCwd of ["", "x".repeat(4097), "😀".repeat(2049), "/project\0other"])
    await expect(f.service.call(method, { ...input, projectCwd }, f.context)).rejects.toThrow();
  expect(f.browserPanel).toHaveBeenCalledTimes(1);
});

it("rejects revoked authority and foreign wire fields before invoking the owner", async () => {
  const f = fixture();
  await expect(f.service.call(method, input, { ...f.context, authorized: async () => false })).rejects.toThrow();
  await expect(f.service.call(method, { ...input, takeover: true }, f.context)).rejects.toThrow();
  expect(f.browserPanel).not.toHaveBeenCalled();
});
