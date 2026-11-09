import {
  AccountApiError,
  type AccountClient,
  type PendingPairRequest,
} from "@bycoda/account-contracts";
import {
  pairSasCode,
  sealPairTicket,
  type PairRandomBytes,
} from "../../../integrations/account-pair-crypto";

export const PAIR_POLL_VISIBLE_MS = 3_000;
export const PAIR_POLL_HIDDEN_MS = 20_000;

export type PhoneConnectInboxDeps = {
  api: Pick<AccountClient, "listPairRequests">;
  onRequests: (requests: PendingPairRequest[]) => void;
  isVisible?: () => boolean;
  visibleMs?: number;
  hiddenMs?: number;
  onError?: (error: unknown) => void;
};

/** Polls the pair requests addressed to this computer; a 404 (old API) ends it quietly. */
export function startPhoneConnectInbox(deps: PhoneConnectInboxDeps): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const visible = deps.isVisible ?? (() => typeof document === "undefined" || !document.hidden);

  async function tick(): Promise<void> {
    try {
      const list = await deps.api.listPairRequests();
      if (stopped) return;
      deps.onRequests(list.items);
    } catch (error) {
      if (error instanceof AccountApiError && error.status === 404) return;
      deps.onError?.(error);
    }
    if (!stopped)
      timer = setTimeout(
        () => tick().catch(() => undefined),
        visible()
          ? (deps.visibleMs ?? PAIR_POLL_VISIBLE_MS)
          : (deps.hiddenMs ?? PAIR_POLL_HIDDEN_MS),
      );
  }

  tick().catch(() => undefined); // -- tick handles its own failures.
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/** The six digits both screens show, so the owner can compare them. */
export const pairRequestCode = (request: PendingPairRequest): string =>
  pairSasCode(request.id, request.phonePublicKey);

/** Binds the sealed box to this request and both devices. Fixed by the protocol; the phone builds the same string. */
export const pairAad = (
  request: Pick<PendingPairRequest, "id" | "phoneDeviceId">,
  desktopDeviceId: string,
  environmentId: string,
): string =>
  `bycoda-pair|${request.id}|${request.phoneDeviceId}|${desktopDeviceId}|${environmentId}`;

export type PairingCodeSource = {
  /** The pairing code object the QR flow would show, from a freshly created owner-gated ticket. */
  code: unknown;
  /** Releases the ticket again when the handoff fails. */
  cancel: () => Promise<void>;
};

export type ApprovePairDeps = {
  api: Pick<AccountClient, "putPairTicket">;
  desktopDeviceId: string;
  environmentId: string;
  createPairingCode: () => Promise<PairingCodeSource>;
  randomBytes?: PairRandomBytes;
  now?: () => number;
};

/** Owner said Allow: create the pairing, seal it to the phone key and hand it to the mailbox. */
export async function approvePairRequest(
  request: PendingPairRequest,
  deps: ApprovePairDeps,
): Promise<void> {
  if (Date.parse(request.expiresAt) <= (deps.now ?? Date.now)())
    throw new Error("This request has expired.");
  const source = await deps.createPairingCode();
  try {
    const sealed = await sealPairTicket(
      JSON.stringify(source.code),
      request.phonePublicKey,
      pairAad(request, deps.desktopDeviceId, deps.environmentId),
      deps.randomBytes,
    );
    await deps.api.putPairTicket({ params: { id: request.id }, body: sealed });
  } catch (error) {
    await source.cancel().catch(() => undefined);
    throw error;
  }
}

export type PairRequestHandlerDeps = {
  api: Pick<AccountClient, "denyPairRequest">;
  /**
   * Shows the request and resolves true on Allow (after running `approve`, which may reject and
   * keep the dialog open) or false on Deny or dismissal.
   */
  ask: (request: PendingPairRequest, approve: () => Promise<void>) => Promise<boolean>;
  approve: (request: PendingPairRequest) => Promise<void>;
  onError?: (error: unknown) => void;
};

/** Ids remembered so a request that is still listed is asked once; the oldest are forgotten. */
export const PAIR_SEEN_LIMIT = 100;

/**
 * Asks about one request at a time, each request once; a Deny or dismissal tells the service.
 * `dispose()` ends it: queued requests are not asked, an answer that arrives later is dropped
 * (no deny, no approve), so a re-run effect or unmount leaves nothing pending.
 */
export function createPairRequestHandler(deps: PairRequestHandlerDeps) {
  const seen = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  let disposed = false;
  const handle = (requests: PendingPairRequest[]): void => {
    if (disposed) return;
    for (const request of requests) {
      if (seen.has(request.id)) continue;
      seen.add(request.id);
      if (seen.size > PAIR_SEEN_LIMIT) seen.delete(seen.values().next().value as string);
      chain = chain.then(async () => {
        if (disposed) return;
        try {
          const allowed = await deps.ask(request, async () => {
            if (disposed) throw new Error("This request is no longer being handled.");
            await deps.approve(request);
          });
          if (!allowed && !disposed) await deps.api.denyPairRequest({ params: { id: request.id } });
        } catch (error) {
          if (!disposed) deps.onError?.(error);
        }
      });
    }
  };
  return Object.assign(handle, {
    dispose: () => {
      disposed = true;
    },
  });
}
