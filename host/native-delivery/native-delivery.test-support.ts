import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { HostStore } from "../store";
import { createNativeDeliveryStore } from "./native-delivery-store";
import { bindNativeDeliveryOwner } from "../ports/native-delivery";
import { createNativeDeliveryService } from "../domains/native-delivery/service";
import type { HostDomainContext } from "../domains/context";
import type { NativeServiceOwnerPorts } from "../domains/native-services/ports";
import type { NativeDeliveryMethod } from "../../src/shared/model/host-contracts/native-delivery";

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
  const principal = deliverySha(device.token);
  let formatCalls = 0;
  let finishCalls = 0;
  let formatHook = async (_params: Record<string, unknown>): Promise<unknown> => ({
    formatted: "formatted 😀",
    cursorOffset: 1,
  });
  let finishHook = async (): Promise<unknown> => ({ accepted: true });
  let journal = createNativeDeliveryStore(store);
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
    return {
      principalId: currentPrincipal,
      authorized,
      nativeServices: services,
      nativeDelivery: bindNativeDeliveryOwner(
        { store, journal, services },
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
    get counts() {
      return { format: formatCalls, finish: finishCalls };
    },
    context,
    call: (method: NativeDeliveryMethod, params: Record<string, unknown>, ctx = context()) =>
      service.call(method, params, ctx),
    setAllowed: (value: boolean) => {
      allowed = value;
    },
    setFormat: (hook: typeof formatHook) => {
      formatHook = hook;
    },
    setFinish: (hook: typeof finishHook) => {
      finishHook = hook;
    },
    async reopen() {
      await store.close();
      store = new HostStore(path);
      if (!(await store.authenticated(device.token)))
        throw new Error("Fixture credential did not survive reopen");
      journal = createNativeDeliveryStore(store);
    },
    async close() {
      await store.close();
      if (!resolve(root).startsWith(base + sep)) throw new Error("Unsafe delivery fixture cleanup");
      await rm(root, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}
