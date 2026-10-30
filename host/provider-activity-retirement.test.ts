import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createChildProcessHandle,
  type ChildProcessHandle,
} from "../src/integrations/harness/core/child";
import { createProviderRetirementLedger } from "../src/integrations/harness/core/providerRetirement";
import {
  PROVIDER_ACTIVITY_CAPACITY,
  ProviderActivityRetirements,
  stopCapturedProvider,
} from "./provider-activity-retirement";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function source(kill: (handle: ChildProcessHandle) => Promise<void>) {
  // Real production family ledger; kernel/transport completion is controlled, not Native proof.
  const ledger = createProviderRetirementLedger(`activity-${randomUUID()}`, kill);
  const id = randomUUID();
  const handle = ledger.admit(createChildProcessHandle(id));
  return { ledger, id, handle };
}

describe("original provider activity retirement", () => {
  it("refuses acquisition on another same-owner family's failed original without touching active children", async () => {
    const mainKill = vi.fn(async (_handle: ChildProcessHandle) => {});
    const { ledger: main, id, handle } = source(mainKill);
    const skills = createProviderRetirementLedger(`activity-skills-${randomUUID()}`, async () => {
      throw new Error("Original skill probe retirement unverified");
    });
    const probe = skills.admit(createChildProcessHandle(id));
    await expect(skills.retire([probe])).rejects.toThrow();
    const records = new ProviderActivityRetirements();
    const acquire = vi.fn(async () => async () => {});
    const ticket = records.reserve(id);
    await expect(ticket.start(acquire)).rejects.toThrow();
    const stop = vi.fn(async () => {});
    await expect(ticket.retire(stop)).rejects.toThrow();
    expect(acquire).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(mainKill).not.toHaveBeenCalled();
    expect(main.observation().active).toBe(1);
    expect(records.observation()).toEqual({ retained: 1, failed: 1 });

    const unrelated = records.reserve(randomUUID());
    const unrelatedAcquire = vi.fn(async () => undefined);
    await unrelated.start(unrelatedAcquire);
    unrelated.bookkeepingFinished();
    expect(unrelatedAcquire).toHaveBeenCalledOnce();
    expect(records.observation().retained).toBe(1);
    await main.retire([handle]);
  });

  it("waits only the same-owner marked drain before acquisition while unrelated owners proceed", async () => {
    const physical = deferred();
    const { ledger, id, handle } = source(() => physical.promise);
    const retiring = ledger.retire([handle]);
    const records = new ProviderActivityRetirements();
    const blocked = records.reserve(id);
    const acquire = vi.fn(async () => undefined);
    const starting = blocked.start(acquire);
    const unrelated = records.reserve(randomUUID());
    await unrelated.start(async () => undefined);
    unrelated.bookkeepingFinished();
    expect(acquire).not.toHaveBeenCalled();
    physical.resolve();
    await retiring;
    await starting;
    blocked.bookkeepingFinished();
    expect(acquire).toHaveBeenCalledOnce();
    await records.drain();
  });

  it("joins the original stop and actual captured cohort before releasing the lease", async () => {
    const physical = deferred();
    const kill = vi.fn(() => physical.promise);
    const { id, handle } = source(kill);
    const records = new ProviderActivityRetirements();
    const activity = records.reserve(id);
    const release = vi.fn(async () => {});
    await activity.start(async () => release);
    const stop = vi.fn(async () => {});
    const retiring = activity.retire(stop);
    const released = activity.release();
    await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(handle));
    expect(stop).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
    activity.bookkeepingFinished();
    expect(records.observation().retained).toBe(1);
    physical.resolve();
    await retiring;
    await released;
    await records.drain();
    expect(release).toHaveBeenCalledOnce();
    expect(records.observation().retained).toBe(0);
  });

  it("does not release or report failure before the other original cleanup actually finishes", async () => {
    const physical = deferred();
    const { id } = source(() => physical.promise);
    const records = new ProviderActivityRetirements();
    const activity = records.reserve(id);
    const release = vi.fn(async () => {});
    await activity.start(async () => release);
    let ended = false;
    const retiring = activity.retire(async () => {
      throw new Error("original stop failed");
    });
    void retiring.then(
      () => {
        ended = true;
      },
      () => {
        ended = true;
      },
    );
    const released = activity.release();
    await Promise.resolve();
    expect(ended).toBe(false);
    physical.resolve();
    await expect(retiring).rejects.toThrow("Original provider stop/retirement failed");
    await expect(released).rejects.toThrow();
    expect(release).not.toHaveBeenCalled();
    expect(records.observation()).toEqual({ retained: 1, failed: 1 });
    await expect(records.drain()).rejects.toThrow();
  });

  it("keeps a warm original lease passively without killing its replacement", async () => {
    const kill = vi.fn(async (_handle: ChildProcessHandle) => {});
    const { ledger, id, handle: first } = source(kill);
    const records = new ProviderActivityRetirements();
    const activity = records.reserve(id);
    const release = vi.fn(async () => {});
    await activity.start(async () => release);
    const passive = activity.retainWarm();
    activity.bookkeepingFinished();
    const second = ledger.admit(createChildProcessHandle(id));
    expect(release).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
    await ledger.retire([first]);
    await passive;
    expect(release).toHaveBeenCalledOnce();
    expect(kill.mock.calls.map(([handle]) => handle)).toEqual([first]);
    expect(records.observation().retained).toBe(0);
    await ledger.retire([second]);
  });

  it("reuses the same failed attempt rather than stopping a newly supplied provider", async () => {
    const kill = vi.fn(async (_handle: ChildProcessHandle) => {});
    const { id } = source(kill);
    const records = new ProviderActivityRetirements();
    const activity = records.reserve(id);
    const release = vi.fn(async () => {});
    await activity.start(async () => release);
    const stopA = vi.fn(async () => {
      throw new Error("A unknown");
    });
    const first = activity.retire(stopA);
    await expect(first).rejects.toThrow();
    const stopB = vi.fn(async () => {});
    expect(activity.retire(stopB)).toBe(first);
    await expect(activity.retire(stopB)).rejects.toThrow();
    expect(stopA).toHaveBeenCalledOnce();
    expect(stopB).not.toHaveBeenCalled();
    expect(kill).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
  });

  it("retains a failed release callback and never implicitly retries it", async () => {
    const records = new ProviderActivityRetirements();
    const activity = records.reserve(randomUUID());
    const release = vi.fn(async () => {
      throw new Error("lease release failed");
    });
    await activity.start(async () => release);
    await activity.retire(async () => {});
    const released = activity.release();
    activity.bookkeepingFinished();
    await expect(released).rejects.toThrow("lease release failed");
    expect(activity.release()).toBe(released);
    await expect(records.drain()).rejects.toThrow();
    expect(release).toHaveBeenCalledOnce();
    expect(records.observation()).toEqual({ retained: 1, failed: 1 });
  });

  it("retains unknown acquisition rather than inventing an absent resource", async () => {
    const records = new ProviderActivityRetirements();
    const activity = records.reserve(randomUUID());
    await expect(
      activity.start(async () => {
        throw new Error("unknown acquisition");
      }),
    ).rejects.toThrow("unknown acquisition");
    await expect(records.drain()).rejects.toThrow();
    expect(records.observation()).toEqual({ retained: 1, failed: 1 });
  });

  it("reserves capacity before effects, never evicts, and frees only a completed known absence", async () => {
    const records = new ProviderActivityRetirements();
    const originals = Array.from({ length: PROVIDER_ACTIVITY_CAPACITY }, () =>
      records.reserve(randomUUID()),
    );
    const effect = vi.fn(async () => undefined);
    expect(() => records.reserve(randomUUID()).start(effect)).toThrow("capacity");
    expect(effect).not.toHaveBeenCalled();
    expect(records.observation().retained).toBe(PROVIDER_ACTIVITY_CAPACITY);
    await originals[0].start(async () => undefined);
    originals[0].bookkeepingFinished();
    const next = records.reserve(randomUUID());
    expect(records.observation().retained).toBe(PROVIDER_ACTIVITY_CAPACITY);
    for (const original of [...originals.slice(1), next]) {
      await original.start(async () => undefined);
      original.bookkeepingFinished();
    }
    await records.drain();
    expect(records.observation().retained).toBe(0);
  });

  it("does not infer physical completeness from a known absent resource", async () => {
    const kill = vi.fn(async (_handle: ChildProcessHandle) => {});
    const { ledger, id, handle } = source(kill);
    const records = new ProviderActivityRetirements();
    const activity = records.reserve(id);
    await activity.start(async () => undefined);
    await activity.retainWarm();
    activity.bookkeepingFinished();
    await records.drain();
    expect(records.observation().retained).toBe(0);
    expect(ledger.observation().active).toBe(1);
    expect(kill).not.toHaveBeenCalled();
    await ledger.retire([handle]);
  });

  it("joins background bookkeeping that installs a passive waiter after close began", async () => {
    const physical = deferred();
    const { ledger, id, handle } = source(() => physical.promise);
    const records = new ProviderActivityRetirements();
    const activity = records.reserve(id);
    const release = vi.fn(async () => {});
    await activity.start(async () => release);
    const title = deferred();
    activity.trackBookkeeping(
      (async () => {
        await title.promise;
        void activity.retainWarm();
        activity.bookkeepingFinished();
      })(),
    );
    let done = false;
    const closing = records.drain().then(() => {
      done = true;
    });
    title.resolve();
    await Promise.resolve();
    expect(done).toBe(false);
    const retiring = ledger.retire([handle]);
    physical.resolve();
    await retiring;
    await closing;
    expect(release).toHaveBeenCalledOnce();
  });

  it("retains application bookkeeping failure independently of physical success", async () => {
    const records = new ProviderActivityRetirements();
    const activity = records.reserve(randomUUID());
    const release = vi.fn(async () => {});
    await activity.start(async () => release);
    await activity.retire(async () => {});
    await activity.release();
    activity.recordFailure(new Error("original callback failed"));
    await expect(records.drain()).rejects.toThrow();
    expect(release).toHaveBeenCalledOnce();
    expect(records.observation()).toEqual({ retained: 1, failed: 1 });
  });

  it("refuses a new same-owner effect while its original cleanup is unverified", async () => {
    const records = new ProviderActivityRetirements();
    const owner = randomUUID();
    const original = records.reserve(owner);
    await original.start(async () => async () => {});
    original.recordFailure(new Error("original completion unknown"));
    const effect = vi.fn(async () => undefined);
    expect(() => records.reserve(owner).start(effect)).toThrow("unverified");
    expect(effect).not.toHaveBeenCalled();
    expect(records.observation().retained).toBe(1);
    const unrelated = records.reserve(randomUUID());
    await unrelated.start(async () => undefined);
    unrelated.bookkeepingFinished();
    expect(records.observation().retained).toBe(1);
  });

  it("captures shutdown originals before a synchronous stop publishes a new child", async () => {
    const kill = vi.fn(async (_handle: ChildProcessHandle) => {});
    const { ledger, id, handle: first } = source(kill);
    let second!: ChildProcessHandle;
    await stopCapturedProvider(id, async () => {
      second = ledger.admit(createChildProcessHandle(id));
    });
    expect(kill.mock.calls.map(([handle]) => handle)).toEqual([first]);
    expect(ledger.observation().active).toBe(1);
    await ledger.retire([second]);
  });
});
