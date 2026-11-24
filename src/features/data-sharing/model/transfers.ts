import { createStoredSetting } from "../../../shared/lib/storedSetting";

export type SharingMode = "off" | "ask" | "auto";
export type SharingKind = "diagnostics" | "activity" | "statistics" | "tokens";
export type SharingFile = { name: string; text: string };
export type SharingDetails = {
  kind: SharingKind;
  destination: string;
  files: readonly SharingFile[];
  linkedToAccount: boolean;
};
type Transfer = SharingDetails & {
  id: number;
  automatic: boolean;
  inspect(open: boolean): void;
  decide(send: boolean): void;
  start(): void;
  reschedule(): void;
};
type Receipt = SharingDetails & { id: number; sentAt: number };

export function sharingMode(kind: SharingKind, fallback: SharingMode) {
  return createStoredSetting<SharingMode>({
    key: `bycoda.data-sharing.${kind}`,
    event: `bycoda:data-sharing:${kind}`,
    storageEvents: true,
    fallback,
    parse: (value) => (value === "auto" || value === "ask" || value === "off" ? value : fallback),
    serialize: (value) => value,
  });
}

export const activitySharing = sharingMode("activity", "ask");
export const sharingNotices = createStoredSetting({
  key: "bycoda.data-sharing.notices",
  event: "bycoda:data-sharing:notices",
  storageEvents: true,
  fallback: true,
  parse: (value) => value !== "off",
  serialize: (value) => (value ? "on" : "off"),
});

// Only the head of the queue is visible. Automatic transfers start their review delay there.
export function createTransferQueue(receiptsEnabled: () => boolean, delayMs = 10_000) {
  let pending: Transfer[] = [];
  let receipts: Receipt[] = [];
  let accountGeneration = 0;
  let presenters = 0;
  let sequence = 0;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    pending: () => pending[0] ?? null,
    receipts: () => receipts,
    present() {
      presenters++;
      pending[0]?.reschedule();
      return () => {
        presenters--;
        if (presenters === 0) pending[0]?.inspect(false);
      };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dismiss(id: number) {
      receipts = receipts.filter((receipt) => receipt.id !== id);
      notify();
    },
    clearReceipts() {
      if (!receipts.length) return;
      receipts = [];
      notify();
    },
    accountChanged() {
      accountGeneration++;
      for (const item of pending.filter((item) => item.linkedToAccount)) item.decide(false);
      receipts = receipts.filter((receipt) => !receipt.linkedToAccount);
      notify();
    },
    async run(
      details: SharingDetails,
      permission: () => SharingMode,
      send: () => Promise<unknown>,
      signal?: AbortSignal,
    ): Promise<boolean> {
      const mode = permission();
      if (mode === "off" || signal?.aborted) return false;
      const id = ++sequence;
      const generation = accountGeneration;
      const approved = await new Promise<boolean>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let active = false;
        let inspecting = false;
        const cancel = () => transfer.decide(false);
        const visible = () => presenters > 0 && !globalThis.document?.hidden;
        const schedule = () => {
          clearTimeout(timer);
          if (active && transfer.automatic && !inspecting && visible()) {
            timer = setTimeout(() => {
              if (visible()) transfer.decide(permission() === "auto");
            }, delayMs);
          }
        };
        const transfer: Transfer = {
          ...details,
          id,
          automatic: mode === "auto",
          reschedule: schedule,
          start() {
            active = true;
            if (transfer.automatic) {
              globalThis.document?.addEventListener("visibilitychange", schedule);
              schedule();
            }
          },
          inspect(open) {
            inspecting = open;
            schedule();
          },
          decide(yes) {
            if (!pending.includes(transfer)) return;
            clearTimeout(timer);
            globalThis.document?.removeEventListener("visibilitychange", schedule);
            active = false;
            signal?.removeEventListener("abort", cancel);
            const wasFirst = pending[0] === transfer;
            pending = pending.filter((item) => item !== transfer);
            if (wasFirst) pending[0]?.start();
            notify();
            resolve(yes);
          },
        };
        pending = [...pending, transfer];
        signal?.addEventListener("abort", cancel, { once: true });
        if (pending[0] === transfer) transfer.start();
        notify();
      });
      const sameAccount = () => !details.linkedToAccount || generation === accountGeneration;
      if (!approved || signal?.aborted || permission() === "off" || !sameAccount()) return false;
      await send();
      if (receiptsEnabled() && sameAccount() && !signal?.aborted) {
        receipts = [...receipts.slice(-4), { ...details, id, sentAt: Date.now() }];
        notify();
      }
      return true;
    },
  };
}

export const dataTransfers = createTransferQueue(sharingNotices.load);

export const jsonSharingFile = (name: string, body: unknown): SharingFile => ({
  name,
  text: JSON.stringify(body, null, 2),
});
