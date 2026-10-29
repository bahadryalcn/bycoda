import { expect, it, vi } from "vitest";
import {
  createNativeInputClosureRegistry,
  type NativeInputErrorCode,
} from "./native-input-closure-registry";
import type { NativeInputWork } from "./native-input-observer";

class InputError extends Error {
  constructor(
    readonly code: NativeInputErrorCode,
    message: string = code,
  ) {
    super(message);
  }
}
const config = {
  kind: "test-input",
  coveragePrefix: "test",
  subject: "Test",
  noun: "test",
  Error: InputError,
} as const;

it("keeps exact immutable data and kind/coverage separate for independent families", async () => {
  const a = createNativeInputClosureRegistry(config);
  const b = createNativeInputClosureRegistry({
    ...config,
    kind: "other-input",
    coveragePrefix: "other",
  });
  const value = { text: "  \r\n漢", own: undefined, nested: { value: "original" } };
  a.register(() => ({ snapshot: value }));
  const first = await a.captureInputs("root");
  const other = await b.captureInputs("root");
  expect(first.snapshots[0].kind).toBe("test-input");
  expect(Object.hasOwn(first.snapshots[0].snapshot, "own")).toBe(true);
  expect(Object.isFrozen(first.snapshots[0].snapshot.nested)).toBe(true);
  expect(other.snapshots).toEqual([]);
  expect(other.missingCoverage).toContain("other-admission-open");
  value.nested.value = "changed";
  expect(first.current()).toBe(false);
  expect(other.current()).toBe(true);
  first.release();
  other.release();
});

it("preflights every composition before touching any close control", () => {
  const engine = createNativeInputClosureRegistry(config);
  const first = vi.fn();
  const second = vi.fn();
  engine.register(() => ({ snapshot: {} }), { canClose: () => true, close: first });
  engine.register(() => ({ snapshot: {} }), { canClose: () => false, close: second });
  expect(() => engine.beginInputClosure("root", { owner: {}, timeoutMs: 1000 })).toThrow(
    InputError,
  );
  expect(first).not.toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();
});

it("waits for real child settlement and refuses forged or await-wide lineage", async () => {
  const engine = createNativeInputClosureRegistry(config);
  const registration = engine.register(() => ({ snapshot: { text: "retained" } }), {
    canClose: () => true,
    close: () => {},
  });
  const original = registration.operation("accepted")!;
  const gate = engine.beginInputClosure("root", { owner: {}, timeoutMs: 1000 });
  const forged: NativeInputWork = Object.assign(() => {}, {
    apply: <T>(callback: () => T) => callback(),
  });
  expect(registration.operation("new")).toBeNull();
  expect(registration.operation("forged", forged)).toBeNull();
  const child = original.apply(() => registration.operation("actual-child"))!;
  expect(
    await original.apply(async () => {
      await Promise.resolve();
      return registration.allowed();
    }),
  ).toBe(false);
  original();
  let finished = false;
  const capture = gate.capture().then((lease) => {
    finished = true;
    return lease;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  child();
  const lease = await capture;
  expect(lease.current()).toBe(true);
  expect(() => original.apply(() => {})).toThrow(InputError);
  gate.release();
  registration.unregister();
});

it("keeps old gates and actual work across a compatible keeper reload without fresh ownership", async () => {
  const globalKey = `bycoda.test-input-${crypto.randomUUID()}`;
  const old = createNativeInputClosureRegistry({ ...config, globalKey });
  const registration = old.register(() => ({ snapshot: { text: "old original" } }), {
    canClose: () => true,
    close: () => {},
  });
  const work = registration.operation("old")!;
  const gate = old.beginInputClosure("root", { owner: {}, timeoutMs: 1000 });
  const next = createNativeInputClosureRegistry({ ...config, globalKey });
  expect(() => next.beginInputClosure("root", { owner: {}, timeoutMs: 1000 })).toThrow(InputError);
  let settled = false;
  const pending = gate.capture().then((lease) => {
    settled = true;
    return lease;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  work();
  const captured = await pending;
  expect(captured.current()).toBe(false);
  gate.release();
  registration.unregister();
  expect((await next.captureInputs("root")).snapshots).toEqual([]);
});

it("holds omitted mounts without fabricating work and bounds concurrent capture leases", async () => {
  const engine = createNativeInputClosureRegistry(config);
  const registrations = Array.from({ length: 257 }, () =>
    engine.register(() => ({ snapshot: {} })),
  );
  expect(registrations[256].allowed()).toBe(true);
  expect(registrations[256].operation("omitted")).toBeNull();
  await expect(engine.captureInputs("root")).rejects.toMatchObject({ code: "capacity" });
  registrations.forEach((registration) => registration.unregister());
  const leases = await Promise.all(Array.from({ length: 32 }, () => engine.captureInputs("root")));
  await expect(engine.captureInputs("root")).rejects.toMatchObject({ code: "capacity" });
  leases.forEach((lease) => {
    lease.release();
    lease.release();
  });
  expect((await engine.captureInputs("root")).current()).toBe(true);
});

it("bounds live global/owner roots and children while conserving accepted retired work", async () => {
  const engine = createNativeInputClosureRegistry(config);
  const registrations = Array.from({ length: 5 }, () =>
    engine.register(() => ({ snapshot: { text: "kept" } }), {
      canClose: () => true,
      close: () => {},
    }),
  );
  const roots = registrations
    .slice(0, 4)
    .map((registration) => Array.from({ length: 16 }, () => registration.operation("accepted")!));
  expect(roots.flat()).not.toContain(null);
  expect(registrations[0].operation("owner-overflow")).toBeNull();
  expect(roots[0][0].apply(() => registrations[0].operation("child-overflow"))).toBeNull();
  expect(registrations[4].operation("global-overflow")).toBeNull();
  registrations[0].unregister();
  expect(registrations[4].operation("retirement-is-not-settlement")).toBeNull();
  roots[0][0]();
  const last = registrations[4].operation("released-slot")!;
  const gate = engine.beginInputClosure("root", { owner: {}, timeoutMs: 1000 });
  let settled = false;
  const capture = gate.capture().then((lease) => {
    settled = true;
    return lease;
  });
  roots.flat().forEach((work) => work());
  await Promise.resolve();
  expect(settled).toBe(false);
  last();
  const lease = await capture;
  expect(lease.current()).toBe(true);
  gate.release();
  registrations.forEach((registration) => registration.unregister());
});
