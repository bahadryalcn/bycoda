import type { SharedQueue } from "./sharedQueue";

/** Persisted before and after the provider call; only known pre-write waits may defer. */
export type SendJournal = {
  token?: string;
  id?: string;
  clientId: string;
  accepted: boolean | null;
  held?: boolean;
  stopped?: boolean;
};

/** Keep local journal fields off the strict RPC; replay only the original verdict. */
export async function finishQueueAcknowledgement(
  pending: SendJournal,
  call: (action: string, params?: Record<string, unknown>) => Promise<SharedQueue>,
): Promise<{ value: SharedQueue; remove?: string }> {
  try {
    return {
      value: await call("finish", {
        clientId: pending.clientId,
        token: pending.token,
        accepted: pending.accepted,
        ...(pending.accepted === false && pending.held === false ? { deferred: true } : {}),
      }),
    };
  } catch (error) {
    if (!/no longer belongs|Queued send belongs to another client\./i.test(String(error)))
      throw error;
    const value = await call("get");
    if (value.claim?.token === pending.token) throw error;
    const queued = !!pending.id && value.messages.some((row) => row.id === pending.id);
    return queued && pending.accepted === true ? { value, remove: pending.id } : { value };
  }
}
