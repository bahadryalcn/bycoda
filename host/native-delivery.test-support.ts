import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { HostStore } from "./store";
import { createNativeBufferReports } from "./native-buffer/native-buffer-reports";
import { durableWrite } from "./turn-git-history";
import { createNativeDeliveryStore } from "./native-delivery-store";
import { bindNativeDeliveryOwner } from "./ports/native-delivery";
import { createNativeDeliveryService } from "./domains/native-delivery/service";
import type { HostDomainContext } from "./domains/context";
import type { NativeServiceOwnerPorts } from "./domains/native-services/ports";
import type { NativeWorkspaceOwnerActions } from "./domains/native-workspaces/ports";
import type { NativeDeliveryMethod } from "../src/shared/model/host-contracts/native-delivery";

export const deliverySha = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export const deliveryIdentity = (paramsJson: string, originalId = randomUUID()) => ({
  originalId,
  sha256: deliverySha(paramsJson),
  byteLength: Buffer.byteLength(paramsJson),
});

export async function nativeDeliveryFixture(evidenceId = "2026-10-29-host-native-delivery") {
  if (!/^[a-z0-9-]+$/.test(evidenceId)) throw new Error("Invalid delivery fixture evidence ID");
  const base = resolve(`temp/verification/${evidenceId}/fixtures`);
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "owner-")),
    path = join(root, "host.db");
  let store = new HostStore(path),
    device = await store.issueDevice("Delivery fixture"),
    allowed = true;
  const principal = deliverySha(device.token),
    owner = { ownerId: principal, authorizationId: "fixture-owned" };
  let tail: Promise<unknown> = Promise.resolve();
  let writeHook: undefined | ((path: string, bytes: string | Buffer) => Promise<void>);
  let bufferCalls = 0;
  let formatCalls = 0;
  let finishCalls = 0;
  let formatHook = async (_params: Record<string, unknown>): Promise<unknown> => ({
    formatted: "formatted 😀",
    cursorOffset: 1,
  });
  let finishHook = async (): Promise<unknown> => ({ accepted: true });
  const composeBuffers = () =>
    createNativeBufferReports({
      root,
      serial: <T>(action: () => Promise<T>) => {
        const result = tail.then(action);
        tail = result.catch(() => {});
        return result;
      },
      listWorkspaces: async () => [],
      authenticate: async (current) => {
        if (current !== owner || !allowed || !(await store.authenticated(device.token)))
          throw new Error("Fixture owner authorization revoked");
        return deliverySha(owner.ownerId);
      },
      write: async (target, bytes) => {
        await writeHook?.(target, bytes);
        await durableWrite(target, bytes);
      },
    });
  let buffers = composeBuffers(),
    journal = createNativeDeliveryStore(store);
  const unavailable = async (): Promise<never> => {
    throw new Error("Unrelated fixture owner operation was invoked");
  };
  const services: NativeServiceOwnerPorts = {
    describe: unavailable,
    issue: unavailable,
    appendTerminal: unavailable,
    social: {
      status: unavailable,
      enroll: unavailable,
      register: unavailable,
      authority: unavailable,
      reset: unavailable,
    },
    desktop: {
      take: unavailable,
      authorize: unavailable,
      finish: async () => {
        finishCalls++;
        return finishHook();
      },
    },
    format: async (params) => {
      formatCalls++;
      return formatHook(params);
    },
  };
  const context = (currentPrincipal = principal): HostDomainContext => {
    const authorized = async () => allowed && (await store.authenticated(device.token));
    const workspaceOwner: NonNullable<HostDomainContext["workspaceOwner"]> = async (run) =>
      run({
        nativeActivity: {
          updateBuffersWithDelivery: async (input, delivery) => {
            bufferCalls++;
            return buffers.updateBuffers(input, owner, delivery);
          },
          verifyBufferDelivery: (binding, proof) =>
            buffers.verifyDelivery({ binding, proof }, owner),
        },
      } as NativeWorkspaceOwnerActions);
    return {
      principalId: currentPrincipal,
      authorized,
      workspaceOwner,
      nativeServices: services,
      nativeDelivery: bindNativeDeliveryOwner(
        { store, journal, workspaceOwner, services },
        currentPrincipal,
        authorized,
      ),
    };
  };
  const service = createNativeDeliveryService();
  return {
    root,
    principal,
    get store() {
      return store;
    },
    get journal() {
      return journal;
    },
    get buffers() {
      return buffers;
    },
    get counts() {
      return { buffers: bufferCalls, format: formatCalls, finish: finishCalls };
    },
    context,
    report: () =>
      JSON.stringify({ clientId: "client", instanceId: "instance", processId: 1, owners: [] }),
    call: (method: NativeDeliveryMethod, params: Record<string, unknown>, ctx = context()) =>
      service.call(method, params, ctx),
    setAllowed: (value: boolean) => {
      allowed = value;
    },
    setWrite: (hook: typeof writeHook) => {
      writeHook = hook;
    },
    setFormat: (hook: typeof formatHook) => {
      formatHook = hook;
    },
    setFinish: (hook: typeof finishHook) => {
      finishHook = hook;
    },
    async reopen() {
      await buffers.closeRecoveryCatalog();
      await store.close();
      store = new HostStore(path);
      if (!(await store.authenticated(device.token)))
        throw new Error("Fixture credential did not survive reopen");
      journal = createNativeDeliveryStore(store);
      buffers = composeBuffers();
    },
    async close() {
      await buffers.closeRecoveryCatalog();
      await store.close();
      if (!resolve(root).startsWith(base + sep)) throw new Error("Unsafe delivery fixture cleanup");
      await rm(root, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}
