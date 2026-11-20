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

it("runs the effect without a write transaction when no lease is active", async () => {
  const f = await setup();
  try {
    const transaction = vi
      .spyOn(f.store, "transaction")
      .mockRejectedValue(new Error("write closed"));
    const retire = vi.fn();
    await expect(f.owner.retireAll(retire, async () => "revoked")).resolves.toBe("revoked");
    expect(retire).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
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

it("fails a retirement closed at the reader deadline and keeps the fence until the old reader settles", async () => {
  const f = await setup();
  try {
    const owner = new AssistantNativeVoiceLeases(f.store, 20);
    await owner.ready;
    const entered = Promise.withResolvers<void>();
    const settle = Promise.withResolvers<void>();
    let signal!: AbortSignal;
    const reader = owner.withRegistration(
      f.input,
      () => true,
      async (_valid, abort) => {
        signal = abort;
        entered.resolve();
        await settle.promise;
      },
    );
    const settled = reader.catch((error: Error) => error);
    await entered.promise;
    const retire = vi.fn(async (_leases, effect) => effect(() => true));
    await expect(owner.retireAll(retire, async () => "changed")).rejects.toThrow("in-flight");
    expect(retire).not.toHaveBeenCalled();
    expect(signal.aborted).toBe(true);
    // The timeout must not hand out new authority while the old reader is still running.
    await expect(
      owner.withRegistration(
        { ...f.input, generationKey: "new" },
        () => true,
        async () => "leak",
      ),
    ).rejects.toThrow("retirement");
    await expect(
      owner.retireAll(
        async () => "unreachable",
        async () => "unreachable",
      ),
    ).rejects.toThrow("in-flight");
    settle.resolve();
    expect(await settled).toMatchObject({ message: expect.stringContaining("uncertain") });
    const rows = await f.store.db.prepare("SELECT value FROM assistant_native_voice_leases").all();
    expect(rows.map((row) => JSON.parse(String(row.value)).state)).toEqual(["active"]);
    const later = vi.fn(async (_leases, effect) => effect(() => true));
    await expect(owner.retireAll(later, async () => "changed")).resolves.toBe("changed");
    expect(later.mock.calls[0][0]).toHaveLength(1);
    await expect(
      owner.withRegistration(
        { ...f.input, generationKey: "new" },
        () => true,
        async () => "ok",
      ),
    ).resolves.toBe("ok");
  } finally {
    await f.store.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

it("selects only active or corrupt leases through the state index and keeps closed tombstones", async () => {
  const f = await setup();
  try {
    await f.owner.withRegistration(
      f.input,
      () => true,
      async () => undefined,
    );
    await f.owner.retireAll(
      async (_leases, effect) => effect(() => true),
      async () => "closed",
    );
    const plan = await f.store.db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT id,value FROM assistant_native_voice_leases WHERE (CASE WHEN json_valid(value) THEN json_extract(value,'$.state') ELSE 'corrupt' END) IN ('active','corrupt')",
      )
      .all();
    expect(plan.map((row) => String(row.detail)).join(" ")).toContain(
      "assistant_native_voice_leases_state",
    );
    // A closed generation is never deleted, so it can never be registered again.
    await expect(
      f.owner.withRegistration(
        f.input,
        () => true,
        async () => undefined,
      ),
    ).rejects.toThrow("source changed");
    const retire = vi.fn();
    await expect(f.owner.retireAll(retire, async () => "revoked")).resolves.toBe("revoked");
    expect(retire).not.toHaveBeenCalled();
    await f.store.db
      .prepare("INSERT INTO assistant_native_voice_leases(id,value) VALUES(?,?)")
      .run("corrupt", "{not json");
    await expect(f.owner.retireAll(retire, async () => "revoked")).rejects.toThrow();
    expect(retire).not.toHaveBeenCalled();
  } finally {
    await f.store.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
