import { expect, it, vi } from "vitest";

const actions = () => ({
  buildPlan: vi.fn(),
  submit: vi.fn(),
  saveDraft: vi.fn(),
  stop: vi.fn(),
  rewind: vi.fn(async () => true),
  compact: vi.fn(() => true),
  approve: vi.fn(),
  answer: vi.fn(),
});

it("captures the actual registration and refuses a detached same-object replacement", async () => {
  const { captureRemoteSessionActions, registerRemoteSessionActions, remoteSessionActions } =
    await import("./remoteSessionActions");
  const value = actions();
  const firstDispose = registerRemoteSessionActions("same-action-object", value);
  const original = captureRemoteSessionActions("same-action-object")!;
  expect(original.actions).toBe(value);
  expect(original.current()).toBe(true);
  firstDispose();
  expect(original.current()).toBe(false);
  const secondDispose = registerRemoteSessionActions("same-action-object", value);
  const replacement = captureRemoteSessionActions("same-action-object")!;
  expect(replacement.current()).toBe(true);
  expect(original.current()).toBe(false);
  firstDispose();
  expect(remoteSessionActions("same-action-object")).toBe(value);
  expect(replacement.current()).toBe(true);
  secondDispose();
  expect(replacement.current()).toBe(false);
  expect(captureRemoteSessionActions("same-action-object")).toBeUndefined();
});

it("replacing a route invalidates its original capture without changing the public action object", async () => {
  const { captureRemoteSessionActions, registerRemoteSessionActions, remoteSessionActions } =
    await import("./remoteSessionActions");
  const first = actions(),
    second = actions();
  const firstDispose = registerRemoteSessionActions("different-actions", first);
  const original = captureRemoteSessionActions("different-actions")!;
  const secondDispose = registerRemoteSessionActions("different-actions", second);
  expect(original.current()).toBe(false);
  expect(remoteSessionActions("different-actions")).toBe(second);
  firstDispose();
  expect(remoteSessionActions("different-actions")).toBe(second);
  secondDispose();
});

it("does not validate or dispatch through a map abandoned by module replacement", async () => {
  const { captureRemoteSessionActions, registerRemoteSessionActions, remoteSessionActions } =
    await import("./remoteSessionActions");
  const value = actions();
  const dispose = registerRemoteSessionActions("module-replacement", value);
  const original = captureRemoteSessionActions("module-replacement")!;
  vi.resetModules();
  const next = await import("./remoteSessionActions");
  expect(original.current()).toBe(false);
  expect(remoteSessionActions("module-replacement")).toBeUndefined();
  expect(next.remoteSessionActions("module-replacement")).toBeUndefined();
  expect(value.approve).not.toHaveBeenCalled();
  dispose();
});
