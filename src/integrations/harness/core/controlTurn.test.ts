import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlTurnHandle, NativeControlInvoke } from "./controlTurn";

type Client = typeof import("./controlTurn");
type Call = { command: string; args?: Record<string, unknown> };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
// Native is controlled here; the real client below never issues turn identities.
function nativeReceipt(sessionId: string, index = 1) {
  return {
    version: 1,
    sessionId,
    turnId: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
  };
}
function source(dispatch: (command: string, args?: Record<string, unknown>) => Promise<unknown>) {
  const calls: Call[] = [];
  const invoke: NativeControlInvoke = <T>(command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    return dispatch(command, args) as Promise<T>;
  };
  return { invoke, calls };
}
async function client(): Promise<Client> {
  return import("./controlTurn");
}
beforeEach(() => {
  vi.resetModules();
});

describe("original Native control turn client (controlled Native replies)", () => {
  it("keeps two original Native issuers through reversed replies and a later invoke replacement", async () => {
    const api = await client();
    const replyA = deferred<unknown>(),
      replyB = deferred<unknown>();
    const nativeA = source((command) =>
      command === "control_authorize_turn" ? replyA.promise : Promise.resolve(undefined),
    );
    const nativeB = source((command) =>
      command === "control_authorize_turn" ? replyB.promise : Promise.resolve(null),
    );
    let currentInvoke = nativeA.invoke;
    const request = { sessionId: "same", cwd: "/original", appAccess: true };
    const pendingA = api.beginNativeControlTurn(
      request.sessionId,
      request.cwd,
      request.appAccess,
      currentInvoke,
    );
    currentInvoke = nativeB.invoke;
    request.sessionId = "replacement";
    request.cwd = "/changed";
    request.appAccess = false;
    const pendingB = api.beginNativeControlTurn("same", "/other-owner", false, currentInvoke);
    const issuedA = nativeReceipt("same", 1),
      issuedB = nativeReceipt("same", 2);
    replyB.resolve(issuedB);
    const handleB = await pendingB;
    replyA.resolve(issuedA);
    const handleA = await pendingA;
    expect(nativeA.calls[0]).toEqual({
      command: "control_authorize_turn",
      args: { sessionId: "same", cwd: "/original", appAccess: true },
    });
    expect(Object.isFrozen(nativeA.calls[0].args)).toBe(true);
    const capturedA = api.nativeControlTurnReceipt(handleA);
    issuedA.turnId = issuedB.turnId;
    expect(capturedA.turnId).not.toBe(issuedA.turnId);
    expect(api.nativeControlTurnReceipt(handleA)).toBe(capturedA);
    expect(Object.isFrozen(capturedA)).toBe(true);
    expect(Object.keys(capturedA).sort()).toEqual(["sessionId", "turnId", "version"]);
    expect(Object.keys(handleA)).toEqual(["sessionId"]);
    await api.finishNativeControlTurn(handleA);
    expect(nativeA.calls[1]).toEqual({
      command: "control_turn_finished",
      args: { receipt: capturedA },
    });
    expect(nativeB.calls).toHaveLength(1);
    await api.finishNativeControlTurn(handleB);
    expect(nativeB.calls[1]).toEqual({
      command: "control_turn_finished",
      args: { receipt: nativeReceipt("same", 2) },
    });
  });

  it("returns the same finish Promise while pending and after actual completion", async () => {
    const api = await client();
    const end = deferred<unknown>();
    const native = source((command) =>
      command === "control_authorize_turn" ? Promise.resolve(nativeReceipt("A")) : end.promise,
    );
    const handle = await api.beginNativeControlTurn("A", "/A", true, native.invoke);
    const first = api.finishNativeControlTurn(handle);
    expect(api.finishNativeControlTurn(handle)).toBe(first);
    expect(api.retryNativeControlTurn(handle)).toBe(first);
    let completed = false;
    void first.then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(native.calls).toHaveLength(2);
    end.resolve(undefined);
    await first;
    expect(completed).toBe(true);
    expect(api.finishNativeControlTurn(handle)).toBe(first);
    expect(api.retryNativeControlTurn(handle)).toBe(first);
    expect(native.calls).toHaveLength(2);
  });

  it("an observation ending early cannot acknowledge or replay its actual pending finish", async () => {
    const api = await client();
    const actual = deferred<unknown>();
    const native = source((command) =>
      command === "control_authorize_turn" ? Promise.resolve(nativeReceipt("A")) : actual.promise,
    );
    const handle = await api.beginNativeControlTurn("A", "/A", true, native.invoke);
    const finishing = api.finishNativeControlTurn(handle);
    expect(
      await Promise.race([
        finishing.then(() => "acknowledged"),
        Promise.resolve("observation-ended"),
      ]),
    ).toBe("observation-ended");
    expect(api.retryNativeControlTurn(handle)).toBe(finishing);
    expect(native.calls).toHaveLength(2);
    actual.resolve(null);
    await finishing;
    expect(native.calls[1].args).toEqual({ receipt: nativeReceipt("A") });
  });

  it("only an explicit retry after real rejection sends the same original receipt again", async () => {
    const api = await client();
    const failed = deferred<unknown>(),
      retried = deferred<unknown>();
    let finishes = 0;
    const native = source((command) =>
      command === "control_authorize_turn"
        ? Promise.resolve(nativeReceipt("A"))
        : ++finishes === 1
          ? failed.promise
          : retried.promise,
    );
    const handle = await api.beginNativeControlTurn("A", "/A", true, native.invoke);
    await expect(api.retryNativeControlTurn(handle)).rejects.toThrow("no rejected finish");
    expect(native.calls).toHaveLength(1);
    const first = api.finishNativeControlTurn(handle);
    const error = new Error("original Native reply lost");
    failed.reject(error);
    await expect(first).rejects.toBe(error);
    expect(api.finishNativeControlTurn(handle)).toBe(first);
    expect(native.calls).toHaveLength(2);
    const second = api.retryNativeControlTurn(handle);
    expect(second).not.toBe(first);
    expect(api.retryNativeControlTurn(handle)).toBe(second);
    expect(native.calls[2].args).toBeDefined();
    expect(native.calls[2].args).toEqual(native.calls[1].args);
    expect((native.calls[2].args as { receipt: unknown }).receipt).toBe(
      api.nativeControlTurnReceipt(handle),
    );
    retried.resolve(undefined);
    await second;
    expect(finishes).toBe(2);
  });

  it("installs finish ownership before a synchronous reentrant callback can duplicate dispatch", async () => {
    const api = await client();
    let handle!: ControlTurnHandle;
    let nested: Promise<void> | undefined;
    const end = deferred<unknown>();
    const native = source((command) => {
      if (command === "control_authorize_turn") return Promise.resolve(nativeReceipt("A"));
      nested = api.finishNativeControlTurn(handle);
      return end.promise;
    });
    handle = await api.beginNativeControlTurn("A", "/A", true, native.invoke);
    const first = api.finishNativeControlTurn(handle);
    expect(nested).toBe(first);
    expect(native.calls).toHaveLength(2);
    end.resolve(undefined);
    await first;
  });

  it("rejects missing, wrong-session, noncanonical and extended receipts without guessing an identity", async () => {
    const api = await client();
    const good = nativeReceipt("A");
    for (const reply of [
      null,
      undefined,
      {},
      { ...good, version: 2 },
      { ...good, sessionId: "B" },
      { ...good, turnId: "unknown" },
      { ...good, turnId: good.turnId.toUpperCase().replace("4000", "400A") },
      { ...good, turnId: `${good.turnId}\n` },
      { ...good, authority: true },
      { ...good, [Symbol("extra")]: true },
    ]) {
      const native = source(() => Promise.resolve(reply));
      await expect(api.beginNativeControlTurn("A", "/A", true, native.invoke)).rejects.toThrow(
        "identity is unconfirmed",
      );
      expect(native.calls.map((call) => call.command)).toEqual(["control_authorize_turn"]);
    }
    let read = false;
    const accessor = {
      version: 1,
      sessionId: "A",
      get turnId() {
        read = true;
        return good.turnId;
      },
    };
    await expect(
      api.beginNativeControlTurn("A", "/A", true, source(() => Promise.resolve(accessor)).invoke),
    ).rejects.toThrow("identity is unconfirmed");
    expect(read).toBe(false);
  });

  it("serialized or structurally forged handles cannot read receipts or finish another turn", async () => {
    const api = await client();
    const native = source(() => Promise.resolve(nativeReceipt("A")));
    const handle = await api.beginNativeControlTurn("A", "/A", true, native.invoke);
    for (const forged of [{ sessionId: "A" }, JSON.parse(JSON.stringify(handle))]) {
      expect(() => api.nativeControlTurnReceipt(forged as ControlTurnHandle)).toThrow(
        "identity is unconfirmed",
      );
      await expect(api.finishNativeControlTurn(forged as ControlTurnHandle)).rejects.toThrow(
        "handle is unavailable",
      );
      await expect(api.retryNativeControlTurn(forged as ControlTurnHandle)).rejects.toThrow(
        "handle is unavailable",
      );
    }
    expect(native.calls).toHaveLength(1);
  });

  it("unexpected finish data and a non-Promise invocation never become successful completion", async () => {
    const api = await client();
    for (const reply of [false, "ack", { acknowledged: true }]) {
      const native = source((command) =>
        Promise.resolve(command === "control_authorize_turn" ? nativeReceipt("A") : reply),
      );
      const handle = await api.beginNativeControlTurn("A", "/A", true, native.invoke);
      const first = api.finishNativeControlTurn(handle);
      await expect(first).rejects.toThrow("completion is unconfirmed");
      expect(api.finishNativeControlTurn(handle)).toBe(first);
      expect(native.calls).toHaveLength(2);
    }
    const noPromise = (() => nativeReceipt("A")) as unknown as NativeControlInvoke;
    await expect(api.beginNativeControlTurn("A", "/A", true, noPromise)).rejects.toThrow(
      "completion is unconfirmed",
    );
  });

  it("synchronous delivery errors preserve the original failure and do not invent an end", async () => {
    const api = await client();
    const failure = new Error("effect may already have been dispatched");
    const native = source(() => {
      throw failure;
    });
    await expect(api.beginNativeControlTurn("A", "/A", true, native.invoke)).rejects.toBe(failure);
    expect(native.calls.map((call) => call.command)).toEqual(["control_authorize_turn"]);
    const finishSource = source((command) => {
      if (command === "control_authorize_turn") return Promise.resolve(nativeReceipt("B"));
      throw failure;
    });
    const handle = await api.beginNativeControlTurn("B", "/B", false, finishSource.invoke);
    const first = api.finishNativeControlTurn(handle);
    await expect(first).rejects.toBe(failure);
    expect(api.finishNativeControlTurn(handle)).toBe(first);
    expect(finishSource.calls).toHaveLength(2);
  });

  it("reserves bounded ownership before Native effects and frees capacity only after actual success", async () => {
    const api = await client();
    let issued = 0;
    const native = source((command, args) =>
      Promise.resolve(
        command === "control_authorize_turn"
          ? nativeReceipt(args!.sessionId as string, ++issued)
          : null,
      ),
    );
    const handles: ControlTurnHandle[] = [];
    for (let index = 0; index < api.NATIVE_CONTROL_TURN_CAPACITY; index++)
      handles.push(
        await api.beginNativeControlTurn(`session-${index}`, "/workspace", false, native.invoke),
      );
    await expect(
      api.beginNativeControlTurn("overflow", "/workspace", true, native.invoke),
    ).rejects.toThrow("capacity is held");
    expect(issued).toBe(api.NATIVE_CONTROL_TURN_CAPACITY);
    const first = api.finishNativeControlTurn(handles[0]);
    await first;
    const replacement = await api.beginNativeControlTurn(
      "replacement",
      "/workspace",
      false,
      native.invoke,
    );
    expect(replacement.sessionId).toBe("replacement");
    expect(api.finishNativeControlTurn(handles[0])).toBe(first);
    expect(issued).toBe(api.NATIVE_CONTROL_TURN_CAPACITY + 1);
  });

  it("failed authorize outcomes release capacity for new work", async () => {
    const api = await client();
    let effects = 0;
    const native = source(() =>
      ++effects % 2 ? Promise.reject(new Error("reply lost")) : Promise.resolve(undefined),
    );
    for (let index = 0; index < api.NATIVE_CONTROL_TURN_CAPACITY; index++)
      await expect(
        api.beginNativeControlTurn(`unknown-${index}`, "/workspace", false, native.invoke),
      ).rejects.toThrow();
    await expect(
      api.beginNativeControlTurn("new", "/workspace", false, native.invoke),
    ).rejects.toThrow("reply lost");
    expect(effects).toBe(api.NATIVE_CONTROL_TURN_CAPACITY + 1);
    expect(native.calls.every((call) => call.command === "control_authorize_turn")).toBe(true);
  });

  it("invalid caller data refuses before admission and does not exhaust valid Native capacity", async () => {
    const api = await client();
    const native = source(() => Promise.resolve(nativeReceipt("valid")));
    for (let index = 0; index < api.NATIVE_CONTROL_TURN_CAPACITY + 1; index++)
      await expect(
        api.beginNativeControlTurn("bad\0id", "/workspace", false, native.invoke),
      ).rejects.toThrow("input is invalid");
    expect(native.calls).toHaveLength(0);
    const handle = await api.beginNativeControlTurn("valid", "/workspace", false, native.invoke);
    expect(handle.sessionId).toBe("valid");
    expect(native.calls).toHaveLength(1);
  });
});
