import { createHash } from "node:crypto";

export type NarrationEvent = {
  eventId: string;
  kind: "progress" | "completed" | "question" | "reminder";
  text: string;
  createdAt: number;
  projectIds: string[];
  accountProofs?: { accountId: string; version: string }[];
  sourceVersion?: string;
};
export type NarrationIdentity = {
  threadId: string;
  environmentId: string;
  deviceHash: string;
  generation: string;
};
export type NarrationReceipt = NarrationIdentity & {
  event: NarrationEvent;
  state: "pending" | "delivered" | "unknown";
};
type Ports = {
  transaction<T>(effect: () => Promise<T>): Promise<T>;
  read(key: string): Promise<NarrationReceipt | null>;
  write(key: string, receipt: NarrationReceipt): Promise<void>;
  source(eventId: string): Promise<NarrationEvent | undefined>;
  withAuthorization<T>(
    identity: NarrationIdentity,
    event: NarrationEvent,
    effect: (valid: () => boolean) => Promise<T>,
  ): Promise<T>;
};
function key(threadId: string, eventId: string): string {
  return `narration-receipt:${createHash("sha256")
    .update(JSON.stringify([threadId, eventId]))
    .digest("hex")}`;
}
function sameEvent(a: NarrationEvent, b: NarrationEvent): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function sameIdentity(a: NarrationIdentity, b: NarrationIdentity): boolean {
  return (
    a.threadId === b.threadId &&
    a.environmentId === b.environmentId &&
    a.deviceHash === b.deviceHash &&
    a.generation === b.generation
  );
}
export class AssistantNarrationReceipts {
  constructor(private readonly ports: Ports) {}
  async available(threadId: string, eventId: string): Promise<boolean> {
    return !(await this.ports.read(key(threadId, eventId)));
  }
  async claim(identity: NarrationIdentity, eventId: string): Promise<NarrationEvent | undefined> {
    if (
      !identity.threadId ||
      !identity.environmentId ||
      !identity.deviceHash ||
      !identity.generation ||
      !eventId
    )
      return undefined;
    const event = await this.ports.source(eventId);
    if (!event) return undefined;
    return this.ports.withAuthorization(identity, event, (valid) =>
      this.ports.transaction(async () => {
        if (!valid() || (await this.ports.read(key(identity.threadId, eventId)))) return undefined;
        const current = await this.ports.source(eventId);
        if (!valid() || !current || !sameEvent(event, current)) return undefined;
        await this.ports.write(key(identity.threadId, eventId), {
          ...identity,
          event: current,
          state: "pending",
        });
        if (!valid()) throw new Error("Narration source changed before claim.");
        return current;
      }),
    );
  }
  async settle(
    identity: NarrationIdentity,
    eventId: string,
    state: "delivered" | "unknown",
  ): Promise<boolean> {
    const previous = await this.ports.read(key(identity.threadId, eventId));
    if (!previous || !sameIdentity(previous, identity)) return false;
    return this.ports.withAuthorization(identity, previous.event, (valid) =>
      this.ports.transaction(async () => {
        const receipt = await this.ports.read(key(identity.threadId, eventId));
        if (
          !valid() ||
          !receipt ||
          receipt.state !== "pending" ||
          !sameIdentity(receipt, identity) ||
          !sameEvent(receipt.event, previous.event)
        )
          return false;
        await this.ports.write(key(identity.threadId, eventId), { ...receipt, state });
        if (!valid()) throw new Error("Narration authority changed before settlement.");
        return true;
      }),
    );
  }
}
