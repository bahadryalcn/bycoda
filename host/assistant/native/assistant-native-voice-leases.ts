import { createHash } from "node:crypto";
import {
  mergeNativeLibraryProofs,
  type NativeLibraryProof,
} from "./assistant-native-library-proof";
import type { HostStore } from "../../store";

export type NativeVoiceLeaseInput = {
  threadId: string;
  generationKey: string;
  deviceHash: string;
  nativeProofs: NativeLibraryProof[];
};
export type NativeVoiceLease = NativeVoiceLeaseInput & { environmentId: string };
type Stored = { lease: NativeVoiceLease; state: "active" | "closed" };
const id = (environment: string, thread: string, generation: string) =>
  createHash("sha256")
    .update(JSON.stringify([environment, thread, generation]))
    .digest("hex");
const validId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200 && !value.includes("\0");

/** Persistent, per-runtime disclosure leases. The writer fence drains actual readers before retirement. */
export class AssistantNativeVoiceLeases {
  readonly ready: Promise<void>;
  private readers = 0;
  private writers = 0;
  private epoch = 0;
  private waiters: Array<() => void> = [];
  private writerTail: Promise<void> = Promise.resolve();
  constructor(private readonly store: HostStore) {
    this.ready = store.ready.then(() =>
      store.db.exec(
        "CREATE TABLE IF NOT EXISTS assistant_native_voice_leases (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
      ),
    );
  }
  async withRegistration<T>(
    input: NativeVoiceLeaseInput,
    authorized: () => boolean,
    effect: (valid: () => boolean) => Promise<T>,
  ): Promise<T> {
    if (this.writers || !authorized())
      throw new Error("Native voice disclosure is unavailable during retirement.");
    const epoch = this.epoch;
    this.readers++;
    let live = true;
    const valid = () => live && !this.writers && epoch === this.epoch && authorized();
    try {
      await this.ready;
      if (
        !validId(input.threadId) ||
        !validId(input.generationKey) ||
        !/^[a-f0-9]{64}$/.test(input.deviceHash)
      )
        throw new Error("Invalid Native voice generation identity.");
      const proofs = mergeNativeLibraryProofs(input.nativeProofs);
      if (
        !proofs.length ||
        proofs.some(
          (proof) =>
            proof.environmentId !== this.store.environmentId || proof.threadId !== input.threadId,
        )
      )
        throw new Error("Native voice source changed.");
      const key = id(this.store.environmentId, input.threadId, input.generationKey);
      await this.store.transaction(async () => {
        if (!valid()) throw new Error("Native voice disclosure authority changed.");
        const existing = await this.store.db
          .prepare("SELECT value FROM assistant_native_voice_leases WHERE id=?")
          .get(key);
        const previous = existing ? (JSON.parse(existing.value) as Stored) : undefined;
        if (
          previous &&
          (previous.state !== "active" ||
            previous.lease.deviceHash !== input.deviceHash ||
            previous.lease.environmentId !== this.store.environmentId ||
            previous.lease.threadId !== input.threadId ||
            previous.lease.generationKey !== input.generationKey)
        )
          throw new Error("Native voice generation source changed.");
        const lease: NativeVoiceLease = {
          environmentId: this.store.environmentId,
          threadId: input.threadId,
          generationKey: input.generationKey,
          deviceHash: input.deviceHash,
          nativeProofs: mergeNativeLibraryProofs(previous?.lease.nativeProofs ?? [], proofs),
        };
        await this.store.db
          .prepare(
            "INSERT INTO assistant_native_voice_leases(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
          )
          .run(key, JSON.stringify({ lease, state: "active" } satisfies Stored));
        if (!valid()) throw new Error("Native voice disclosure authority changed.");
      }, "critical");
      if (!valid()) throw new Error("Native voice disclosure authority changed.");
      const result = await effect(valid);
      if (!valid()) throw new Error("Native voice disclosure outcome is uncertain.");
      return result;
    } finally {
      live = false;
      if (--this.readers === 0) for (const waiter of this.waiters.splice(0)) waiter();
    }
  }
  async retireAll<T>(
    retire: (
      leases: NativeVoiceLease[],
      effect: (valid: () => boolean) => Promise<T>,
    ) => Promise<T>,
    effect: (valid: () => boolean) => Promise<T>,
  ): Promise<T> {
    this.epoch++;
    this.writers++;
    const previous = this.writerTail;
    let release!: () => void;
    this.writerTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      await this.ready;
      if (this.readers) await new Promise<void>((resolve) => this.waiters.push(resolve));
      const rows = await this.store.db
        .prepare("SELECT id,value FROM assistant_native_voice_leases")
        .all();
      const active = rows
        .map((row) => ({ id: String(row.id), value: JSON.parse(row.value) as Stored }))
        .filter((row) => row.value.state === "active");
      let activeWriter = true;
      const writerValid = () => activeWriter;
      try {
        let effectStarted = false;
        let effectCompleted = false;
        let effectInFlight: Promise<T> | undefined;
        const guarded = (nativeValid: () => boolean): Promise<T> => {
          if (effectStarted || !writerValid() || !nativeValid())
            throw new Error("Native voice retirement authority changed.");
          effectStarted = true;
          effectInFlight = (async () => {
            const result = await effect(() => writerValid() && nativeValid());
            if (!writerValid() || !nativeValid())
              throw new Error("Native voice retirement outcome is uncertain.");
            effectCompleted = true;
            return result;
          })();
          return effectInFlight;
        };
        let result: T;
        try {
          result = active.length
            ? await retire(
                active.map((row) => row.value.lease),
                guarded,
              )
            : await guarded(() => true);
        } finally {
          // A callback cannot retire the fence while a started effect is still settling.
          if (effectInFlight) await effectInFlight.catch(() => undefined);
        }
        if (!effectCompleted) throw new Error("Native voice retirement effect was not confirmed.");
        // Nothing to close: a privacy change must not depend on an empty write transaction.
        if (!active.length) return result;
        await this.store.transaction(async () => {
          for (const row of active) {
            const current = await this.store.db
              .prepare("SELECT value FROM assistant_native_voice_leases WHERE id=?")
              .get(row.id);
            if (!current || current.value !== JSON.stringify(row.value))
              throw new Error("Native voice retirement source changed.");
            await this.store.db
              .prepare("UPDATE assistant_native_voice_leases SET value=? WHERE id=?")
              .run(JSON.stringify({ ...row.value, state: "closed" } satisfies Stored), row.id);
          }
        }, "critical");
        return result;
      } finally {
        activeWriter = false;
      }
    } finally {
      this.writers--;
      release();
    }
  }
}
