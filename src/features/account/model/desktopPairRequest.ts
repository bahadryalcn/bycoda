import type { AccountClient } from "@bycoda/account-contracts";
import {
  generatePairKeypair,
  openPairTicket,
  pairSasCode,
  type PairRandomBytes,
} from "../../../integrations/account-pair-crypto";
import { pairAad } from "./phoneConnectInbox";

/** How often the requesting desktop asks whether the other computer answered. */
export const DESKTOP_PAIR_POLL_MS = 2_000;

export type DesktopPairTarget = { deviceId: string; environmentId: string };

export type DesktopPairOutcome =
  | { state: "sealed"; ticketJson: string }
  | { state: "denied" | "expired" | "cancelled" };

export type DesktopPairDeps = {
  api: Pick<AccountClient, "createPairRequest" | "getPairRequest">;
  /** This computer's account device id: the request's requester, bound into the sealed box. */
  deviceId: string;
  randomBytes?: PairRandomBytes;
  pollMs?: number;
  now?: () => number;
  signal?: AbortSignal;
};

export type DesktopPairRequest = {
  /** Six digits the owner compares with the ones the other computer shows. */
  code: string;
  expiresAt: string;
  /** Settles on the answer; never rejects for a refusal, only for a transport or crypto failure. */
  outcome: Promise<DesktopPairOutcome>;
  /** Stops polling and forgets the key; `outcome` settles as cancelled. */
  cancel: () => void;
};

/**
 * Asks another of the account's computers for a connection, the same mailbox the phone uses: a
 * fresh X25519 key goes up, the sealed ticket comes back and is opened here. The key lives only
 * in this closure and is zeroed when the request ends. The service never sees the ticket in clear.
 */
export async function requestDesktopPair(
  target: DesktopPairTarget,
  deps: DesktopPairDeps,
): Promise<DesktopPairRequest> {
  const keypair = await generatePairKeypair(deps.randomBytes);
  const forget = () => keypair.privateKey.fill(0);
  if (deps.signal?.aborted) {
    forget();
    return {
      code: "",
      expiresAt: "",
      outcome: Promise.resolve({ state: "cancelled" }),
      cancel: forget,
    };
  }
  let created: { id: string; expiresAt: string };
  try {
    created = await deps.api.createPairRequest({
      params: { deviceId: target.deviceId },
      body: { phonePublicKey: keypair.publicKey },
    });
  } catch (error) {
    forget();
    throw error;
  }
  const { id } = created;
  let cancelled = deps.signal?.aborted ?? false;
  let wake: (() => void) | undefined;
  const cancel = () => {
    cancelled = true;
    forget();
    wake?.();
  };
  deps.signal?.addEventListener("abort", cancel, { once: true });
  const sleep = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, deps.pollMs ?? DESKTOP_PAIR_POLL_MS);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  async function settle(): Promise<DesktopPairOutcome> {
    for (;;) {
      if (cancelled) return { state: "cancelled" };
      const status = await deps.api.getPairRequest({ params: { id } });
      if (cancelled) return { state: "cancelled" };
      if (status.state === "sealed") {
        if (!status.desktopPublicKey || !status.sealed) return { state: "expired" };
        const ticketJson = openPairTicket(
          { desktopPublicKey: status.desktopPublicKey, sealed: status.sealed },
          keypair.privateKey,
          pairAad({ id, phoneDeviceId: deps.deviceId }, target.deviceId, target.environmentId),
        );
        return { state: "sealed", ticketJson };
      }
      if (status.state === "denied" || status.state === "expired") return { state: status.state };
      // "delivered" means a ticket was taken elsewhere: it cannot be read again.
      if (status.state === "delivered") return { state: "expired" };
      if (Date.parse(created.expiresAt) + 5_000 <= (deps.now ?? Date.now)())
        return { state: "expired" };
      await sleep();
    }
  }

  const outcome = settle()
    .catch((error): DesktopPairOutcome => {
      if (cancelled) return { state: "cancelled" };
      throw error;
    })
    .finally(() => {
      deps.signal?.removeEventListener("abort", cancel);
      forget();
    });
  return {
    code: pairSasCode(id, keypair.publicKey),
    expiresAt: created.expiresAt,
    outcome,
    cancel,
  };
}
