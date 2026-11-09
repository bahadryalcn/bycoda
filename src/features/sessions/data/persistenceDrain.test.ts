import { afterEach, describe, expect, it, vi } from "vitest";
import { PersistenceDrainRegistry } from "./persistenceDrain";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const attempts: { abandon(): void }[] = [];
function begin(
  registry: PersistenceDrainRegistry,
  scope: readonly string[] | "profile" = ["a"],
  options = {},
) {
  const attempt = registry.beginAttempt(scope, options);
  attempts.push(attempt);
  return attempt;
}
afterEach(() => {
  attempts.splice(0).forEach((attempt) => attempt.abandon());
  vi.useRealTimers();
});

describe("renderer persistence observation boundaries", () => {
  it("retains accepted async work and its later nested commit through actual settlement", async () => {
    const registry = new PersistenceDrainRegistry();
    const producer = registry.registerProducer("writer");
    const prepared = deferred();
    const commit = deferred();
    const written: string[] = [];
    const operation = producer.run(["a"], "draft", async (parent) => {
      await prepared.promise;
      await producer.run(
        ["a"],
        "draft",
        async (work) => {
          await commit.promise;
          written.push("kept");
          work.confirmRecovery();
        },
        { parent },
      );
    });
    const attempt = begin(registry);
    let observed = false;
    const observation = attempt.observe().then((result) => {
      observed = true;
      return result;
    });
    prepared.resolve();
    await Promise.resolve();
    expect(observed).toBe(false);
    commit.resolve();
    await operation;
    expect(await observation).toMatchObject({ qualified: false });
    expect(written).toEqual(["kept"]);
    attempt.assertCurrent();
  });

  it("invalidates late target admission while still performing the ordinary write", async () => {
    const registry = new PersistenceDrainRegistry();
    const producer = registry.registerProducer("writer");
    const attempt = begin(registry);
    let retained = "";
    await producer.run(["a"], "draft", () => {
      retained = "new unsent text";
    });
    await expect(attempt.observe()).rejects.toMatchObject({ code: "late-producer" });
    expect(retained).toBe("new unsent text");
  });

  it("allows unrelated writes and mutations but conservatively relates shared resources", async () => {
    const registry = new PersistenceDrainRegistry();
    const producer = registry.registerProducer("writer");
    const attempt = begin(registry);
    await producer.run(["b"], "draft", () => undefined);
    producer.noteMutation(["b"]);
    await expect(attempt.observe()).resolves.toMatchObject({ qualified: false });
    await producer.run("profile", "workspace", () => undefined);
    expect(() => attempt.assertCurrent()).toThrow("observation boundary");
  });

  it("invalidates an already returned observation on a later local edit", async () => {
    const registry = new PersistenceDrainRegistry();
    const attempt = begin(registry);
    expect((await attempt.observe()).missingCoverage).toEqual([
      "native-checkpoint",
      "mounted-composers",
      "provider-output",
      "producer-coverage",
    ]);
    registry.noteMutation(["a"]);
    expect(() => attempt.assertCurrent()).toThrow("Local data changed");
  });

  it("allows explicit checkpoint writes without mistaking them for late ordinary admission", async () => {
    const registry = new PersistenceDrainRegistry();
    let writes = 0;
    const producer = registry.registerProducer("writer", {
      flush: (scope, parent) =>
        producer.run(
          scope,
          "draft",
          (work) => {
            writes += 1;
            work.confirmRecovery();
          },
          { parent },
        ),
    });
    const attempt = begin(registry);
    await attempt.observe();
    expect(writes).toBe(1);
    attempt.assertCurrent();
  });

  it("keeps caught failures sticky until an explicit domain-confirmed replacement", async () => {
    const registry = new PersistenceDrainRegistry();
    const producer = registry.registerProducer("writer");
    await producer.run(["a"], "transcript", (work) => work.fail(new Error("unknown commit")));
    await producer.run(["a"], "transcript", () => undefined);
    await expect(begin(registry).observe()).rejects.toMatchObject({ code: "failed-write" });
    await producer.run(["a"], "transcript", (work) => work.confirmRecovery());
    await expect(begin(registry).observe()).resolves.toMatchObject({ qualified: false });
  });

  it("does not clear a newer failure with an older successful receipt", async () => {
    const registry = new PersistenceDrainRegistry();
    const producer = registry.registerProducer("writer");
    const receipt = deferred();
    const older = producer.run(["a"], "transcript", async (work) => {
      await receipt.promise;
      work.confirmRecovery();
    });
    await producer.run(["a"], "transcript", (work) => work.fail(new Error("newer")));
    receipt.resolve();
    await older;
    await expect(begin(registry).observe()).rejects.toThrow("Unconfirmed persistence");
  });

  it("cannot repair the same attempt after a failed accepted write", async () => {
    const registry = new PersistenceDrainRegistry();
    const producer = registry.registerProducer("writer");
    const pending = deferred();
    const writing = producer.run(["a"], "draft", () => pending.promise);
    const attempt = begin(registry);
    const observing = expect(attempt.observe()).rejects.toMatchObject({ code: "failed-write" });
    pending.reject(new Error("disk full"));
    await expect(writing).rejects.toThrow("disk full");
    await producer.run(["a"], "draft", (work) => work.confirmRecovery());
    await observing;
    expect(() => attempt.assertCurrent()).toThrow("Persistence work failed");
  });

  it("does not relate another session's failed write", async () => {
    const registry = new PersistenceDrainRegistry();
    const producer = registry.registerProducer("writer");
    await producer.run(["b"], "draft", (work) => work.fail("failed b"));
    await expect(begin(registry).observe()).resolves.toMatchObject({ qualified: false });
  });

  it("stops waiting on cancellation while retaining accepted work for another attempt", async () => {
    const registry = new PersistenceDrainRegistry();
    const flushed = vi.fn(async () => {});
    const producer = registry.registerProducer("writer", { flush: flushed });
    const pending = deferred();
    const writing = producer.run(["a"], "draft", () => pending.promise);
    const abort = new AbortController();
    const attempt = begin(registry, ["a"], { signal: abort.signal });
    const first = expect(attempt.observe()).rejects.toMatchObject({ code: "cancelled" });
    abort.abort();
    await first;
    let observed = false;
    const next = begin(registry)
      .observe()
      .then(() => {
        observed = true;
      });
    await Promise.resolve();
    expect(observed).toBe(false);
    pending.resolve();
    await writing;
    await next;
    expect(flushed).toHaveBeenCalledTimes(1);
  });

  it("expires a waiting attempt without cancelling the actual write", async () => {
    vi.useFakeTimers();
    const registry = new PersistenceDrainRegistry();
    const producer = registry.registerProducer("writer");
    const pending = deferred();
    const writing = producer.run(["a"], "draft", () => pending.promise);
    const attempt = begin(registry, ["a"], { timeoutMs: 10 });
    const observed = expect(attempt.observe()).rejects.toMatchObject({ code: "deadline" });
    await vi.advanceTimersByTimeAsync(10);
    await observed;
    pending.resolve();
    await writing;
  });

  it("retains retiring registrants until accepted work and the final flush settle", async () => {
    const registry = new PersistenceDrainRegistry();
    const pending = deferred();
    const flushed = deferred();
    const producer = registry.registerProducer("writer", { flush: () => flushed.promise });
    const writing = producer.run(["a"], "draft", () => pending.promise);
    const retirement = producer.retire();
    expect(() => registry.registerProducer("writer")).toThrow("already registered");
    await expect(producer.run(["a"], "draft", () => undefined)).rejects.toThrow("retired");
    pending.resolve();
    await writing;
    await Promise.resolve();
    expect(() => registry.registerProducer("writer")).toThrow("already registered");
    flushed.resolve();
    await retirement;
    expect(() => registry.registerProducer("writer")).not.toThrow();
  });

  it("does not count a failed retiring flusher as removal", async () => {
    const registry = new PersistenceDrainRegistry();
    const producer = registry.registerProducer("writer", {
      flush: async () => {
        throw new Error("capture failed");
      },
    });
    await expect(producer.retire()).rejects.toThrow("capture failed");
    expect(() => registry.registerProducer("writer")).toThrow("already registered");
  });

  it("can retry a retiring capture and never lets a caller bypass retirement using its key", async () => {
    const registry = new PersistenceDrainRegistry();
    let fail = true;
    const producer = registry.registerProducer("writer", {
      flush: async () => {
        if (fail) throw new Error("capture failed");
      },
    });
    await expect(producer.retire()).rejects.toThrow("capture failed");
    const attempt = begin(registry);
    const invoked = vi.fn();
    await expect(producer.run(["a"], "retirement", invoked)).rejects.toThrow("retired");
    expect(invoked).not.toHaveBeenCalled();
    await expect(attempt.observe()).rejects.toMatchObject({ code: "producer-changed" });
    fail = false;
    await producer.retire();
    expect(() => registry.registerProducer("writer")).not.toThrow();
  });

  it("cannot return a zero-deadline observation before the timer callback runs", async () => {
    const registry = new PersistenceDrainRegistry();
    await expect(begin(registry, ["a"], { timeoutMs: 0 }).observe()).rejects.toMatchObject({
      code: "deadline",
    });
  });

  it("keeps module versions' hooks serialized and retains them until a full-profile flush", async () => {
    const registry = new PersistenceDrainRegistry();
    const oldReceipt = deferred();
    const calls: string[] = [];
    const old = registry.reuseModuleProducer("writer", {
      flush: async () => {
        calls.push("old-start");
        await oldReceipt.promise;
        calls.push("old-end");
      },
    });
    registry.reuseModuleProducer("writer", {
      flush: async () => {
        calls.push("new");
      },
    });
    const observation = begin(registry).observe();
    await vi.waitFor(() => expect(calls).toEqual(["old-start"]));
    oldReceipt.resolve();
    await observation;
    expect(calls).toEqual(["old-start", "old-end", "new"]);
    calls.length = 0;
    await begin(registry, "profile").observe();
    expect(calls).toEqual(["old-start", "old-end", "new"]);
    calls.length = 0;
    await begin(registry).observe();
    expect(calls).toEqual(["new"]);
    calls.length = 0;
    old.noteMutation(["a"]);
    await begin(registry).observe();
    expect(calls).toEqual(["old-start", "old-end", "new"]);
  });

  it("does not race overlapping jobs across module versions or lose their failure ledger", async () => {
    const registry = new PersistenceDrainRegistry();
    const old = registry.reuseModuleProducer("writer");
    const pending = deferred();
    const writing = old.run(["a"], "draft", () => pending.promise);
    const attempt = begin(registry);
    const next = registry.reuseModuleProducer("writer");
    const invoked = vi.fn();
    const replacement = next.run(["a"], "draft", invoked);
    expect(invoked).not.toHaveBeenCalled();
    pending.reject(new Error("old native reply lost"));
    await expect(writing).rejects.toThrow("reply lost");
    await replacement;
    expect(invoked).toHaveBeenCalledOnce();
    await expect(attempt.observe()).rejects.toMatchObject({ code: "producer-changed" });
    await expect(begin(registry).observe()).rejects.toMatchObject({ code: "failed-write" });
    await next.run(["a"], "draft", (work) => work.confirmRecovery());
    await expect(begin(registry).observe()).resolves.toMatchObject({ qualified: false });
  });

  it("fails coverage explicitly at the bounded module-hook limit while ordinary writes continue", async () => {
    const registry = new PersistenceDrainRegistry();
    const flush = async () => {};
    for (let index = 0; index < 18; index++) registry.reuseModuleProducer("writer", { flush });
    const producer = registry.reuseModuleProducer("writer", { flush });
    const kept = vi.fn();
    await producer.run(["a"], "draft", kept);
    expect(kept).toHaveBeenCalledOnce();
    await expect(begin(registry).observe()).rejects.toMatchObject({ code: "capacity" });
  });

  it("lets an incumbent's accepted nested commit finish before a waiting newer module", async () => {
    const registry = new PersistenceDrainRegistry();
    const old = registry.reuseModuleProducer("writer");
    const ready = deferred();
    const order: string[] = [];
    const incumbent = old.run(["a"], "flush", async (parent) => {
      await ready.promise;
      await old.run(
        ["a"],
        "draft",
        () => {
          order.push("old nested commit");
        },
        { parent },
      );
    });
    const next = registry.reuseModuleProducer("writer");
    const newer = next.run(["a"], "draft", () => {
      order.push("new commit");
    });
    ready.resolve();
    await Promise.all([incumbent, newer]);
    expect(order).toEqual(["old nested commit", "new commit"]);
  });

  it("wakes an already admitted producer without treating wake as its native receipt", async () => {
    const registry = new PersistenceDrainRegistry();
    const ready = deferred();
    const nativeAck = deferred();
    const wake = vi.fn(() => ready.resolve());
    const producer = registry.registerProducer("writer", { wake });
    const accepted = producer.run(["a"], "draft", async () => {
      await ready.promise;
      await nativeAck.promise;
    });
    let observed = false;
    const observation = begin(registry)
      .observe()
      .then(() => {
        observed = true;
      });
    await Promise.resolve();
    expect(wake).toHaveBeenCalledWith(["a"]);
    expect(observed).toBe(false);
    nativeAck.resolve();
    await accepted;
    await observation;
  });

  it("rejects stale and widened nested admission before invoking it", async () => {
    const registry = new PersistenceDrainRegistry();
    const producer = registry.registerProducer("writer");
    let saved!: Parameters<typeof producer.run>[3];
    await producer.run(["a"], "draft", (parent) => {
      saved = { parent };
    });
    const attempt = begin(registry);
    const invoked = vi.fn();
    expect(() => producer.run(["a"], "draft", invoked, saved)).toThrow(
      "Invalid persistence parent",
    );
    expect(invoked).not.toHaveBeenCalled();
    await expect(attempt.observe()).rejects.toMatchObject({ code: "invalid-parent" });
    await producer.run(["a"], "draft", (parent) => {
      expect(() => producer.run("profile", "workspace", invoked, { parent })).toThrow(
        "Invalid persistence parent",
      );
    });
  });
});
