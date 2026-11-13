import { createHash, randomBytes } from "node:crypto";
import type { HostStore } from "../../store";

export type BackgroundEffectSource = {
  environmentId: string;
  threadId: string;
  operationId: string;
  projectId?: string;
  action: "git.merge" | "social.send";
  input: Record<string, unknown>;
};

/** Identity supplied by the authenticated Native service channel, never by the operation. */
export type BackgroundEffectActor = { deviceHash: string; authorized: () => Promise<boolean> };
type Receipt = {
  environmentId: string;
  threadId: string;
  operationId: string;
  operationHash: string;
  challengeHash: string;
  expiresAt: number;
  state: "prepared" | "denied" | "unknown" | "completed";
  result?: unknown;
};
export type BackgroundEffectStatus =
  | { state: "missing" }
  | { state: "prepared"; expiresAt: number }
  | { state: "denied"; expiresAt: number }
  | { state: "unknown" }
  | { state: "completed"; result: unknown };
export class BackgroundEffectStateError extends Error {
  constructor(
    readonly state: "prepared" | "denied" | "unknown",
    readonly expiresAt?: number,
  ) {
    super(`Background effect ${state}; inspect its receipt.`);
  }
}
type Pending = {
  receipt: Receipt;
  monotonicDeadline: number;
  execute: (actor: BackgroundEffectActor) => Promise<unknown>;
};
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const identity = (
  source: Pick<BackgroundEffectSource, "environmentId" | "threadId" | "operationId">,
) => digest(JSON.stringify([source.environmentId, source.threadId, source.operationId]));

/** Durable one-shot callback owner. The callback is reachable only from the Native channel. */
export class AssistantBackgroundEffect {
  private readonly ready: Promise<void>;
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly store: HostStore) {
    this.ready = store.ready.then(() =>
      store.db.exec(
        "CREATE TABLE IF NOT EXISTS assistant_background_effect (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
      ),
    );
  }

  async prepare(source: BackgroundEffectSource, execute: Pending["execute"], expiresAt: number) {
    await this.ready;
    const monotonicDeadline = performance.now() + Math.max(0, expiresAt - Date.now());
    const encoded = JSON.stringify(source);
    if (
      source.environmentId !== this.store.environmentId ||
      !source.threadId ||
      source.threadId.length > 200 ||
      !source.operationId ||
      source.operationId.length > 200 ||
      (source.projectId !== undefined && (!source.projectId || source.projectId.length > 200)) ||
      !["git.merge", "social.send"].includes(source.action) ||
      Buffer.byteLength(encoded) > 32768 ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= Date.now() ||
      expiresAt > Date.now() + 60_000
    )
      throw new Error("Invalid background effect identity.");
    for (const [key, value] of this.pending) {
      if (value.receipt.expiresAt <= Date.now() || value.monotonicDeadline <= performance.now())
        this.pending.delete(key);
    }
    const challenge = randomBytes(32).toString("hex");
    const receipt: Receipt = {
      environmentId: source.environmentId,
      threadId: source.threadId,
      operationId: source.operationId,
      operationHash: digest(encoded),
      challengeHash: digest(challenge),
      expiresAt,
      state: "prepared",
    };
    const id = identity(source);
    const previous = await this.store.transaction(async () => {
      const row = await this.store.db
        .prepare("SELECT value FROM assistant_background_effect WHERE id=?")
        .get(id);
      if (row) {
        const existing = JSON.parse(String(row.value)) as Receipt;
        if (
          existing.operationHash !== receipt.operationHash ||
          existing.environmentId !== source.environmentId ||
          existing.threadId !== source.threadId ||
          existing.operationId !== source.operationId
        )
          throw new Error("Background effect identity was reused with different source or input.");
        if (existing.state === "completed") return existing;
        if (existing.state === "unknown") throw new BackgroundEffectStateError("unknown");
        if (
          (existing.state !== "prepared" && existing.state !== "denied") ||
          !Number.isSafeInteger(existing.expiresAt)
        )
          throw new Error("Background effect receipt is corrupt.");
        if (existing.expiresAt > Date.now())
          throw new BackgroundEffectStateError(existing.state, existing.expiresAt);
        if (this.pending.size >= 64)
          throw new Error("Background effect callback capacity reached.");
        await this.store.db
          .prepare("UPDATE assistant_background_effect SET value=? WHERE id=?")
          .run(JSON.stringify(receipt), id);
        return null;
      }
      if (this.pending.size >= 64) throw new Error("Background effect callback capacity reached.");
      await this.store.db
        .prepare("INSERT INTO assistant_background_effect(id,value) VALUES(?,?)")
        .run(id, JSON.stringify(receipt));
      return null;
    }, "critical");
    if (previous) return { state: "completed" as const, result: previous.result ?? null };
    this.pending.set(id, { receipt, monotonicDeadline, execute });
    return {
      state: "prepared" as const,
      sourceJson: encoded,
      operationHash: receipt.operationHash,
      challenge,
      expiresAt,
    };
  }

  async status(source: BackgroundEffectSource): Promise<BackgroundEffectStatus> {
    await this.ready;
    const row = await this.store.db
      .prepare("SELECT value FROM assistant_background_effect WHERE id=?")
      .get(identity(source));
    if (!row) return { state: "missing" };
    const receipt = JSON.parse(String(row.value)) as Receipt;
    if (
      receipt.environmentId !== source.environmentId ||
      receipt.threadId !== source.threadId ||
      receipt.operationId !== source.operationId ||
      receipt.operationHash !== digest(JSON.stringify(source))
    )
      throw new Error("Background effect identity was reused with different source or input.");
    if (receipt.state === "completed")
      return { state: "completed", result: receipt.result ?? null };
    if (receipt.state === "unknown") return { state: "unknown" };
    if (
      (receipt.state === "prepared" || receipt.state === "denied") &&
      Number.isSafeInteger(receipt.expiresAt)
    )
      return { state: receipt.state, expiresAt: receipt.expiresAt };
    throw new Error("Background effect receipt is corrupt.");
  }

  async deny(input: {
    environmentId: string;
    threadId: string;
    operationId: string;
    operationHash: string;
    challenge: string;
  }) {
    await this.ready;
    const id = identity(input);
    await this.store.transaction(async () => {
      const row = await this.store.db
        .prepare("SELECT value FROM assistant_background_effect WHERE id=?")
        .get(id);
      const receipt = row ? (JSON.parse(String(row.value)) as Receipt) : null;
      if (
        !receipt ||
        receipt.state !== "prepared" ||
        receipt.operationHash !== input.operationHash ||
        receipt.challengeHash !== digest(input.challenge)
      )
        throw new Error("Background effect denial identity changed.");
      await this.store.db
        .prepare("UPDATE assistant_background_effect SET value=? WHERE id=?")
        .run(JSON.stringify({ ...receipt, state: "denied" }), id);
    }, "critical");
    this.pending.delete(id);
  }

  async execute(
    input: {
      environmentId: string;
      threadId: string;
      operationId: string;
      operationHash: string;
      challenge: string;
    },
    actor: BackgroundEffectActor,
  ) {
    await this.ready;
    const id = identity(input);
    const pending = this.pending.get(id);
    const effectActor: BackgroundEffectActor = {
      deviceHash: actor.deviceHash,
      authorized: async () =>
        !!pending &&
        pending.receipt.expiresAt > Date.now() &&
        pending.monotonicDeadline > performance.now() &&
        (await actor.authorized()) &&
        pending.receipt.expiresAt > Date.now() &&
        pending.monotonicDeadline > performance.now(),
    };
    if (
      !pending ||
      !/^[a-f0-9]{64}$/.test(actor.deviceHash) ||
      pending.receipt.operationHash !== input.operationHash ||
      pending.receipt.challengeHash !== digest(input.challenge) ||
      pending.receipt.expiresAt <= Date.now() ||
      !(await effectActor.authorized())
    )
      throw new Error("Background effect authority is unavailable.");
    const claimed = await this.store.transaction(async () => {
      const row = await this.store.db
        .prepare("SELECT value FROM assistant_background_effect WHERE id=?")
        .get(id);
      const current = row ? (JSON.parse(String(row.value)) as Receipt) : null;
      if (
        !current ||
        current.state !== "prepared" ||
        current.operationHash !== input.operationHash ||
        current.challengeHash !== digest(input.challenge) ||
        current.expiresAt <= Date.now() ||
        pending.monotonicDeadline <= performance.now()
      )
        return false;
      await this.store.db
        .prepare("UPDATE assistant_background_effect SET value=? WHERE id=?")
        .run(JSON.stringify({ ...current, state: "unknown" }), id);
      return true;
    }, "critical");
    if (!claimed) throw new Error("Background effect already claimed or expired.");
    this.pending.delete(id);
    if (!(await effectActor.authorized()))
      throw new Error("Background effect authority changed; outcome unknown.");
    const result = await pending.execute(effectActor);
    const encodedResult = JSON.stringify(result ?? null);
    if (encodedResult === undefined || Buffer.byteLength(encodedResult, "utf8") > 32768)
      throw new Error("Background effect result is unavailable; outcome unknown.");
    const savedResult = JSON.parse(encodedResult) as unknown;
    await this.store.db
      .prepare("UPDATE assistant_background_effect SET value=? WHERE id=?")
      .run(JSON.stringify({ ...pending.receipt, state: "completed", result: savedResult }), id);
    return savedResult;
  }
}
