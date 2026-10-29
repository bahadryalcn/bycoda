import { expect, it, vi } from "vitest";
import { createNotesInputClosure } from "../../features/notes/notesInputClosure";
import {
  createNativeInputControlPort,
  issueNativeInputPublication,
  consumeNativeInputPublication,
  type NativeInputPublication,
  type NativeInputObserver,
  type NativeInputRead,
} from "./native-input-observer";
import { copyNativeCaptureData } from "./native-capture-json";

it("acknowledges only the exact one-time owned React publication under real synchronous work", async () => {
  const engine = createNotesInputClosure();
  const registration = engine.register(() => ({ snapshot: { text: "actual" } }), {
    canClose: () => true,
    close: () => {},
  });
  const work = registration.operation("accepted")!;
  const gate = engine.beginNotesInputClosure("root", { owner: {}, timeoutMs: 1000 });
  const target = {};
  const state = { value: "actual React state" };
  let generation = 1;
  const committed = vi.fn(() => work());
  const proof = issueNativeInputPublication({
    target,
    value: state,
    current: () => generation === 1,
    apply: (callback) => work.apply(callback),
    committed,
  });
  expect(consumeNativeInputPublication({ ...proof } as NativeInputPublication, target, state)).toBe(
    false,
  );
  expect(consumeNativeInputPublication(proof, {}, state)).toBe(false);
  expect(consumeNativeInputPublication(proof, target, { ...state })).toBe(false);
  expect(
    consumeNativeInputPublication(proof, target, state, () => {
      expect(registration.allowed()).toBe(true);
      registration.changed();
    }),
  ).toBe(true);
  expect(registration.allowed()).toBe(false);
  expect(consumeNativeInputPublication(proof, target, state)).toBe(false);
  expect(committed).toHaveBeenCalledOnce();
  expect(() => copyNativeCaptureData({ proof })).toThrow();
  generation++;
  gate.release();
  registration.unregister();
});

it("never substitutes same bytes or a stale external/view generation for its publication", () => {
  const target = {};
  let externalGeneration = 1;
  const apply = vi.fn(<T>(callback: () => T): T => callback());
  const committed = vi.fn();
  const proof = issueNativeInputPublication({
    target,
    value: "same",
    current: () => externalGeneration === 1,
    apply,
    committed,
  });
  externalGeneration++;
  expect(consumeNativeInputPublication(proof, target, "same")).toBe(false);
  expect(consumeNativeInputPublication(undefined, target, "same")).toBe(false);
  expect(apply).not.toHaveBeenCalled();
  expect(committed).not.toHaveBeenCalled();
});

it("does not ACK or replay an asynchronous publication projection", () => {
  const target = {};
  const committed = vi.fn();
  const proof = issueNativeInputPublication({
    target,
    value: "state",
    current: () => true,
    apply: <T>(callback: () => T): T => callback(),
    committed,
  });
  const projection = vi.fn(async () => {});
  expect(consumeNativeInputPublication(proof, target, "state", projection)).toBe(false);
  expect(consumeNativeInputPublication(proof, target, "state", projection)).toBe(false);
  expect(projection).toHaveBeenCalledOnce();
  expect(committed).not.toHaveBeenCalled();
});

it("keeps a no-DOM retired input registered until its original result actually settles", async () => {
  const engine = createNotesInputClosure();
  let readAgain!: () => NativeInputRead;
  const retired: NativeInputRead[] = [];
  const observer: NativeInputObserver = {
    attach(read, controls) {
      readAgain = read;
      const registered = engine.register(read, controls);
      return {
        ...registered,
        unregister: () => {
          retired.push(read());
          registered.unregister();
        },
      };
    },
  };
  const raw = vi.fn(() => ({ snapshot: { raw: "  exact draft  ", phase: "saving" } }));
  const port = createNativeInputControlPort(observer, raw, {
    canClose: () => true,
    close: () => {},
  });
  const original = port.operation("actual-save")!;
  port.retire();
  raw.mockImplementation(() => {
    throw new Error("retired DOM must never be read");
  });
  expect(readAgain().snapshot.raw).toBe("  exact draft  ");
  expect(readAgain().busy).toBe("shared-input-work");
  expect(retired).toHaveLength(0);
  expect(() => engine.beginNotesInputClosure("root", { owner: {}, timeoutMs: 1000 })).toThrow();
  original.apply(() => port.retiredOutcome({ phase: "saved" }));
  port.finish(original);
  port.finish(original);
  expect(retired).toHaveLength(1);
  expect(retired[0].snapshot).toEqual({ raw: "  exact draft  ", phase: "saved" });
  expect(retired[0].busy).toBeUndefined();
  expect((await engine.captureNotesInputs("root")).snapshots).toEqual([]);
});

it("holds an uncopyable retired input without throwing into view teardown or fabricating emptiness", async () => {
  const engine = createNotesInputClosure();
  const unregister = vi.fn();
  const observer: NativeInputObserver = {
    attach(read, controls) {
      const registered = engine.register(read, controls);
      return {
        ...registered,
        unregister: () => {
          unregister();
          registered.unregister();
        },
      };
    },
  };
  const port = createNativeInputControlPort(
    observer,
    () => ({ snapshot: { unsupported: () => {} } }),
    { canClose: () => true, close: () => {} },
  );
  expect(() => port.retire()).not.toThrow();
  expect(unregister).not.toHaveBeenCalled();
  await expect(engine.captureNotesInputs("root")).rejects.toMatchObject({
    code: "invalid-snapshot",
  });
  expect(() => engine.beginNotesInputClosure("root", { owner: {}, timeoutMs: 1000 })).toThrow();
});
