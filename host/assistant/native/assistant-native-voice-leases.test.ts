import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { HostStore } from "../../store";
import { AssistantNativeVoiceLeases } from "./assistant-native-voice-leases";

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "native-voice-leases-"));
  const path = join(directory, "host.db");
  const store = new HostStore(path);
  const owner = new AssistantNativeVoiceLeases(store);
  await owner.ready;
  const proof = {
    environmentId: store.environmentId,
    threadId: "room",
    installationId: "desktop",
    issuer: "window",
    registryRevision: "registry",
    visibilityEpoch: 1,
    policyGeneration: "policy",
  };
  const input = {
    threadId: "room",
    generationKey: "generation",
    deviceHash: "a".repeat(64),
    nativeProofs: [proof],
  };
  return { directory, path, store, owner, proof, input };
}

it("retains an uncertain generation across restart and recovers only the original source", async () => {
  const f = await setup();
  let store = f.store;
  try {
    const work = vi.fn(async () => "disclosed");
    await expect(f.owner.withRegistration(f.input, () => true, work)).resolves.toBe("disclosed");
    await expect(
      f.owner.withRegistration({ ...f.input, deviceHash: "b".repeat(64) }, () => true, work),
    ).rejects.toThrow("source changed");
    await expect(
      f.owner.withRegistration(
        { ...f.input, nativeProofs: [{ ...f.proof, issuer: "replacement" }] },
        () => true,
        work,
      ),
    ).rejects.toThrow("source changed");
    expect(work).toHaveBeenCalledTimes(1);
    const uncertain = vi.fn(async () => {
      throw new Error("original device unavailable");
    });
    await expect(f.owner.retireAll(uncertain, async () => "changed")).rejects.toThrow(
      "original device unavailable",
    );
    await store.close();
    store = new HostStore(f.path);
    const resumed = new AssistantNativeVoiceLeases(store);
    const retire = vi.fn(async (leases, effect) => {
      expect(leases).toEqual([{ environmentId: store.environmentId, ...f.input }]);
      return effect(() => true);
    });
    await expect(
      resumed.retireAll(retire, async (valid) => {
        expect(valid()).toBe(true);
        return "changed";
      }),
    ).resolves.toBe("changed");
    expect(retire).toHaveBeenCalledOnce();
    await expect(resumed.withRegistration(f.input, () => true, work)).rejects.toThrow(
      "source changed",
    );
    await expect(resumed.retireAll(retire, async () => "done")).resolves.toBe("done");
    expect(retire).toHaveBeenCalledOnce();
  } finally {
    await store.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

it("blocks new disclosure immediately and waits for the actual in-flight effect to settle", async () => {
  const f = await setup();
  try {
    const entered = Promise.withResolvers<void>();
    const settle = Promise.withResolvers<void>();
    const retireCalled = vi.fn();
    const reader = f.owner.withRegistration(
      f.input,
      () => true,
      async (valid) => {
        expect(valid()).toBe(true);
        entered.resolve();
        await settle.promise;
        expect(valid()).toBe(false);
      },
    );
    await entered.promise;
    const writer = f.owner.retireAll(
      async (leases, effect) => {
        retireCalled(leases);
        return effect(() => true);
      },
      async () => "changed",
    );
    await expect(
      f.owner.withRegistration(
        { ...f.input, generationKey: "new" },
        () => true,
        async () => "leak",
      ),
    ).rejects.toThrow("retirement");
    await Promise.resolve();
    expect(retireCalled).not.toHaveBeenCalled();
    settle.resolve();
    await expect(reader).rejects.toThrow("uncertain");
    await expect(writer).resolves.toBe("changed");
    expect(retireCalled).toHaveBeenCalledOnce();
  } finally {
    await f.store.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

it("never clears a lease when retirement skips the effect or authority is lost", async () => {
  const f = await setup();
  try {
    await f.owner.withRegistration(
      f.input,
      () => true,
      async () => undefined,
    );
    await expect(
      f.owner.retireAll(
        async () => "unproven",
        async () => "changed",
      ),
    ).rejects.toThrow("not confirmed");
    await expect(
      f.owner.retireAll(
        async (_leases, effect) => effect(() => false),
        async () => "changed",
      ),
    ).rejects.toThrow("authority changed");
    const retired = vi.fn(async (_leases, effect) => effect(() => true));
    await expect(f.owner.retireAll(retired, async () => "done")).resolves.toBe("done");
    expect(retired.mock.calls[0][0]).toHaveLength(1);
  } finally {
    await f.store.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

it("keeps the writer fence while a started effect settles even if its callback returns early", async () => {
  const f = await setup();
  try {
    await f.owner.withRegistration(
      f.input,
      () => true,
      async () => undefined,
    );
    const started = Promise.withResolvers<void>();
    const settlement = Promise.withResolvers<void>();
    const writer = f.owner.retireAll(
      async (_leases, effect) => {
        void effect(() => true);
        return "callback";
      },
      async () => {
        started.resolve();
        await settlement.promise;
        return "effect";
      },
    );
    await started.promise;
    await expect(
      f.owner.withRegistration(
        { ...f.input, generationKey: "later" },
        () => true,
        async () => undefined,
      ),
    ).rejects.toThrow("retirement");
    settlement.resolve();
    await expect(writer).resolves.toBe("callback");
  } finally {
    await f.store.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
