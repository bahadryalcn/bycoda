import { afterEach, expect, it, vi } from "vitest";
import { HostTerminals } from "../../terminals";
import { createTerminalService } from "./service";
import { getHostRpcMethod } from "../../../src/shared/model/host-contracts";

const running: HostTerminals[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((terminals) => terminals.close()));
});
function fixture(locate = async (root: string) => root) {
  let output!: (data: string) => void;
  const child = { write: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
  const launch = vi.fn((_profile, _cwd, write, onExit) => {
    output = write;
    return {
      write: child.write,
      stop: async () => {
        await child.stop();
        onExit(0);
      },
    };
  });
  const terminals = new HostTerminals(
    launch,
    () => ({
      profiles: [{ id: "fixture", name: "Fixture", path: "/fixture", kind: "sh" }],
      defaultId: "fixture",
      chosenId: null,
    }),
    locate,
  );
  running.push(terminals);
  const activity = vi.fn(async () => {});
  const service = createTerminalService({
    project: async (id) => ({ id, cwd: "/project" }),
    terminals,
    activity,
  });
  let permitted = true;
  const context = { principalId: "device-one", authorized: async () => permitted };
  const params = { projectId: "project", requestId: "create-one" };
  return {
    service,
    terminals,
    context,
    params,
    child,
    launch,
    activity,
    output: (text: string) => output(text),
    revoke: () => {
      permitted = false;
    },
  };
}

it("shares the creation receipt across transports and keeps separate device ownership", async () => {
  const f = fixture();
  const first = await f.service.create(f.params, f.context);
  expect(await f.service.create(f.params, f.context, { legacy: true })).toEqual(first);
  const second = await f.service.create(f.params, { ...f.context, principalId: "device-two" });
  expect(second).not.toEqual(first);
  expect(f.launch).toHaveBeenCalledTimes(2);
  await expect(f.service.read({ projectId: "other", id: first.id }, f.context)).rejects.toThrow();
});

it("checks a revoked grant after asynchronous workspace resolution before launching a process", async () => {
  let release!: () => void;
  const located = new Promise<void>((resolve) => {
    release = resolve;
  });
  const locate = vi.fn(async (root: string) => {
    await located;
    return root;
  });
  const f = fixture(locate);
  const creation = f.service.create(f.params, f.context);
  const rejected = expect(creation).rejects.toThrow(/revoked/);
  await vi.waitFor(() => expect(locate).toHaveBeenCalledOnce());
  f.revoke();
  release();
  await rejected;
  expect(f.launch).not.toHaveBeenCalled();
});

it("prevents late output disclosure and retains the shell owner's UTF-8 input bounds", async () => {
  const f = fixture();
  const terminal = await f.service.create(f.params, f.context);
  f.output("private output");
  await expect(
    f.service.write({ projectId: "project", id: terminal.id, data: "😀".repeat(4097) }, f.context),
  ).rejects.toThrow(/UTF-8/);
  expect(f.child.write).not.toHaveBeenCalled();
  f.activity.mockImplementationOnce(async () => {
    f.revoke();
  });
  await expect(
    f.service.read({ projectId: "project", id: terminal.id }, f.context),
  ).rejects.toThrow(/revoked/);
});

it("never replays an uncertain write and reserves only terminal stop/close admission", async () => {
  const f = fixture();
  const terminal = await f.service.create(f.params, f.context);
  f.child.write.mockRejectedValueOnce(new Error("Outcome is unknown"));
  await expect(
    f.service.write({ projectId: "project", id: terminal.id, data: "run\n" }, f.context),
  ).rejects.toThrow(/unknown/);
  expect(f.child.write).toHaveBeenCalledTimes(1);
  for (const method of ["terminals.create", "terminals.write"])
    expect(getHostRpcMethod(method)).toMatchObject({
      retry: "never",
      cancellation: "wait-only",
      cost: "read",
    });
  for (const method of ["terminals.interrupt", "terminals.close"])
    expect(getHostRpcMethod(method)).toMatchObject({
      retry: "never",
      cancellation: "wait-only",
      cost: "control",
    });
});
