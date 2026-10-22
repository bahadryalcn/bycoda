import { expect, it, vi } from "vitest";
import { createMobilePtyControl } from "./mobilePtyControl";
it("requires the actual focused source guard and pins actor/native identity without accepting caller overrides", async () => {
  const call = vi.fn(async () => ({ accepted: true }));
  const eligible = vi.fn(async () => {});
  let open = true;
  const context = {
    environmentId: "env",
    sourceSessionId: "source",
    projectCwd: "/project",
    workingCwd: "/checkout",
    actorId: "actor",
    valid: () => open,
    authorize: async () => true,
  };
  const control = createMobilePtyControl({ call, eligible });
  await control(context, "ptyMobile.list", {});
  expect(eligible).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith("ptyMobile.list", {
    environmentId: "env",
    sessionId: "source",
    projectCwd: "/checkout",
    actorId: "actor",
  });
  await expect(control(context, "ptyMobile.create", { cwd: "/foreign" })).rejects.toThrow(
    "Unsupported",
  );
  expect(call).toHaveBeenCalledTimes(1);
  const blocked = createMobilePtyControl({
    call,
    eligible: async () => {
      open = false;
    },
  });
  await expect(blocked(context, "ptyMobile.list", {})).rejects.toThrow("changed");
  expect(call).toHaveBeenCalledTimes(1);
});
it("rechecks revoked authority after the asynchronous lifecycle guard before any native effect", async () => {
  const call = vi.fn(async () => ({ accepted: true }));
  const authorize = vi.fn(async () => false);
  const context = {
    environmentId: "env",
    sourceSessionId: "source",
    projectCwd: "/project",
    workingCwd: "/checkout",
    actorId: "actor",
    valid: () => true,
    authorize,
  };
  const control = createMobilePtyControl({
    call,
    eligible: async () => {
      await Promise.resolve();
    },
  });
  for (const action of ["create", "attach", "write", "resize", "detach", "close"])
    await expect(control(context, `ptyMobile.${action}`, {})).rejects.toThrow("revoked");
  expect(authorize).toHaveBeenCalledTimes(6);
  expect(call).not.toHaveBeenCalled();
  await control(context, "ptyMobile.list", {});
  expect(authorize).toHaveBeenCalledTimes(6);
  expect(call).toHaveBeenCalledTimes(1);
});
