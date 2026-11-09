import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelOwnerSecretInput,
  ownerSecretInputsSnapshot,
  requestOwnerSecretInput,
  submitOwnerSecretInput,
} from "./ownerSecretInputs";

const VALUE = "synthetic-owner-typed-value";
let counter = 0;

function payload(overrides: Record<string, unknown> = {}, sessionId: unknown = "s1") {
  counter += 1;
  return {
    id: `secret-${counter}`,
    sessionId,
    input: {
      title: "bycoda — Secret request",
      message: "Project: C:/work\nName: NPM_TOKEN\nPurpose: publish",
      fieldLabel: "NPM_TOKEN",
      confirmLabel: "Save secret",
      cancelLabel: "Cancel",
      deadline: Date.now() + 60_000,
      ...overrides,
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("owner secret inputs", () => {
  it("settles with the typed value once and keeps no copy in the store", async () => {
    const request = payload();
    const promise = requestOwnerSecretInput(request);
    expect(ownerSecretInputsSnapshot()).toHaveLength(1);
    expect(submitOwnerSecretInput(request.id, VALUE)).toBe(true);
    await expect(promise).resolves.toBe(VALUE);
    expect(ownerSecretInputsSnapshot()).toEqual([]);
    expect(JSON.stringify(ownerSecretInputsSnapshot())).not.toContain(VALUE);
  });

  it("refuses a second submit and never re-delivers the value on replay", async () => {
    const request = payload();
    const promise = requestOwnerSecretInput(request);
    expect(submitOwnerSecretInput(request.id, VALUE)).toBe(true);
    await promise;
    expect(submitOwnerSecretInput(request.id, VALUE)).toBe(false);
    await expect(requestOwnerSecretInput(request)).resolves.toBeNull();
  });

  it("rejects empty and oversized values and keeps the request open", async () => {
    const request = payload();
    const promise = requestOwnerSecretInput(request);
    expect(submitOwnerSecretInput(request.id, "")).toBe(false);
    expect(submitOwnerSecretInput(request.id, "x".repeat(8193))).toBe(false);
    expect(ownerSecretInputsSnapshot()).toHaveLength(1);
    cancelOwnerSecretInput(request.id);
    await expect(promise).resolves.toBeNull();
  });

  it("cancel settles with null and never with a value", async () => {
    const request = payload();
    const promise = requestOwnerSecretInput(request);
    cancelOwnerSecretInput(request.id);
    await expect(promise).resolves.toBeNull();
    expect(submitOwnerSecretInput(request.id, VALUE)).toBe(false);
    expect(ownerSecretInputsSnapshot()).toEqual([]);
  });

  it("deadline cancels the request and drops it from the store", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const request = payload({ deadline: 1_000_000 + 5_000 });
    const promise = requestOwnerSecretInput(request);
    vi.advanceTimersByTime(5_000);
    await expect(promise).resolves.toBeNull();
    expect(ownerSecretInputsSnapshot()).toEqual([]);
    expect(submitOwnerSecretInput(request.id, VALUE)).toBe(false);
  });

  it("a submit after the deadline is not delivered", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const request = payload({ deadline: 1_000_000 + 5_000 });
    const promise = requestOwnerSecretInput(request);
    vi.setSystemTime(1_000_000 + 5_000);
    expect(submitOwnerSecretInput(request.id, VALUE)).toBe(false);
    await expect(promise).resolves.toBeNull();
  });

  it("a revoked source settles with null", async () => {
    let active = true;
    let notify: (() => void) | undefined;
    const request = payload();
    const promise = requestOwnerSecretInput(
      request,
      () => active,
      (listener) => {
        notify = listener;
        return () => undefined;
      },
    );
    active = false;
    notify?.();
    await expect(promise).resolves.toBeNull();
    expect(ownerSecretInputsSnapshot()).toEqual([]);
  });

  it("rejects an invalid payload before showing anything", () => {
    const request = payload({ fieldLabel: undefined });
    expect(() => requestOwnerSecretInput(request)).toThrow("Invalid secret request.");
    expect(ownerSecretInputsSnapshot()).toEqual([]);
  });

  it("refuses a deadline beyond the approval window", () => {
    expect(() => requestOwnerSecretInput(payload({ deadline: Date.now() + 10 * 60_000 }))).toThrow(
      "Invalid secret request.",
    );
  });
});
