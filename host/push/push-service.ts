import type { HostSessionSummary } from "../../src/features/connections/model/protocol";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import { hostWarnDeduped } from "../diagnostics/log-dedupe";
import { sendExpoPush, type ExpoPushMessage } from "./expo-push";
import {
  AssistantPushLedger,
  assistantPushAllowed,
  assistantPushMessage,
  type AssistantPushSource,
} from "./push-assistant";
import {
  detectPushEvents,
  PUSH_EVENT_KINDS,
  type PushEvent,
  type PushEventKind,
  type PushSnapshot,
} from "./push-events";
import type { ApprovalRegistry } from "../approvals/approval-registry";
import type { PushDeviceStore, PushRecipient } from "./push-store";

/** A desktop window counts as in use for this long after its last active report. */
export const DESKTOP_PRESENCE_MS = 20_000;
const POLL_MS = 4_000;
// shortcut: a burst sends the first few events per phone; group them into one summary if bursts are common.
const MAX_PER_TICK = 3;

type Dependencies = {
  store: PushDeviceStore;
  environmentId: string;
  /** Every top-level conversation on this Host, desktop-owned ones included. */
  sessions: () => Promise<HostSessionSummary[]>;
  /** Pending Assistant notifications with the Host's own delivery verdicts; absent disables that channel. */
  assistant?: AssistantPushSource;
  assistantLedger?: AssistantPushLedger;
  /** Remote-answerable owner approvals; absent disables that channel. */
  approvals?: ApprovalRegistry;
  send?: typeof sendExpoPush;
  now?: () => number;
  pollMs?: number;
};

/**
 * Sends Expo pushes when a conversation finishes, fails or waits for the
 * owner. The Host decides once for every phone: nothing is sent while someone
 * is using the desktop app on this computer, because its own banners and
 * in-app indicators already reach them. A phone looking at the conversation
 * suppresses its own banner.
 */
export class PushNotifications {
  private snapshot: PushSnapshot | undefined;
  private presence = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  private readonly now: () => number;
  private readonly send: typeof sendExpoPush;

  constructor(private readonly deps: Dependencies) {
    this.now = deps.now ?? monotonicNow;
    this.send = deps.send ?? sendExpoPush;
  }

  /** Reported on each desktop heartbeat: focused window with recent input. */
  desktopPresence(clientId: string, active: boolean): void {
    if (active) this.presence.set(clientId, this.now());
    else this.presence.delete(clientId);
  }

  desktopActive(): boolean {
    for (const [clientId, at] of this.presence) {
      if (elapsedSince(at, this.now()) <= DESKTOP_PRESENCE_MS) return true;
      // A closed window stops reporting; drop it so the map cannot grow.
      this.presence.delete(clientId);
    }
    return false;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.tick().then(
        () => this.schedule(),
        (error: unknown) => {
          hostWarnDeduped(
            `Push notifications: ${error instanceof Error ? error.message : String(error)}`,
          );
          this.schedule();
        },
      );
    }, this.deps.pollMs ?? POLL_MS);
    this.timer.unref?.();
  }

  /** One read of every conversation; exported for tests. */
  async tick(): Promise<void> {
    const recipients = await this.deps.store.recipients();
    if (recipients.length === 0) {
      // Nobody to notify: skip the list read, and start from a fresh baseline later.
      this.snapshot = undefined;
      return;
    }
    const { events, next } = detectPushEvents(this.snapshot, await this.deps.sessions());
    this.snapshot = next;
    const away = !this.desktopActive();
    if (events.length > 0 && away)
      await this.deliver(
        recipients.flatMap((recipient) =>
          events
            .filter((event) => recipient.events[event.kind])
            .slice(0, MAX_PER_TICK)
            .map((event) => this.message(recipient, event)),
        ),
      );
    if (away) await this.tickAssistant(recipients);
    if (away) await this.tickApprovals(recipients);
  }

  /**
   * An approval that waits while nobody uses the desktop reaches each interested phone once. The message
   * carries no operation text; the phone opens the approval and reads the full summary from the Host.
   */
  private async tickApprovals(recipients: PushRecipient[]): Promise<void> {
    const registry = this.deps.approvals;
    if (!registry) return;
    const waiting = registry.unpushed();
    if (waiting.length === 0) return;
    // Marked before sending: a failed send is not retried, so a flaky push service cannot repeat it.
    for (const item of waiting) registry.markPushed(item.id);
    await this.deliver(
      recipients
        .filter((recipient) => recipient.events.approvals)
        .flatMap((recipient) =>
          waiting.slice(0, MAX_PER_TICK).map((item): ExpoPushMessage => ({
            to: recipient.pushToken,
            title: recipient.title,
            body: recipient.texts.approvals,
            data: {
              kind: "approval",
              approvalId: item.id,
              environmentId: this.deps.environmentId,
            },
            sound: "default",
            channelId: "bycoda",
            priority: "high",
          })),
        ),
    );
  }

  /**
   * Assistant notifications wait on the Host for a desktop window that may never open. With no desktop
   * in use, each phone hears about each one once; acknowledging stays with the owner.
   */
  private async tickAssistant(recipients: PushRecipient[]): Promise<void> {
    const { assistant, assistantLedger: ledger } = this.deps;
    const interested = recipients.filter((recipient) => recipient.events.assistant);
    if (!assistant || !ledger || interested.length === 0) return;
    const pending = await assistant();
    if (pending.length === 0) return;
    const sends: { recipient: PushRecipient; id: string; message: ExpoPushMessage }[] = [];
    for (const recipient of interested) {
      const done = await ledger.sent(
        recipient.deviceHash,
        pending.map((item) => item.id),
      );
      for (const item of pending) {
        if (done.has(item.id) || !assistantPushAllowed(item, recipient)) continue;
        sends.push({
          recipient,
          id: item.id,
          message: assistantPushMessage(recipient, item, this.deps.environmentId),
        });
      }
    }
    if (sends.length === 0) return;
    await this.deliver(sends.map((send) => send.message));
    for (const send of sends) await ledger.record(send.recipient.deviceHash, send.id, Date.now());
    await ledger.prune(Date.now());
  }

  /**
   * The event kinds at least one registered phone receives from this Host. The desktop leaves those
   * to the Host instead of also reporting them to the account, which would push the same phone twice.
   */
  async ownedEvents(): Promise<PushEventKind[]> {
    const recipients = await this.deps.store.recipients();
    return PUSH_EVENT_KINDS.filter((kind) =>
      recipients.some((recipient) => recipient.events[kind]),
    );
  }

  /** Sends a sample to the calling phone, bypassing presence and event choices. */
  async test(deviceHash: string, body: string): Promise<boolean> {
    const [recipient] = await this.deps.store.recipients(deviceHash);
    if (!recipient) return false;
    const message = this.message(recipient, { kind: "finished", sessionId: "", projectId: "" });
    await this.deliver([{ ...message, body, data: { kind: "test" } }]);
    return true;
  }

  private message(recipient: PushRecipient, event: PushEvent): ExpoPushMessage {
    return {
      to: recipient.pushToken,
      title: recipient.title,
      body: recipient.texts[event.kind],
      data: {
        kind: event.kind,
        sessionId: event.sessionId,
        projectId: event.projectId,
        environmentId: this.deps.environmentId,
      },
      sound: "default",
      channelId: "bycoda",
      priority: "high",
    };
  }

  private async deliver(messages: ExpoPushMessage[]): Promise<void> {
    if (messages.length === 0) return;
    const result = await this.send(messages);
    for (const token of result.unregistered) await this.deps.store.forgetToken(token);
    if (result.failed > 0)
      hostWarnDeduped(`Push notifications: Expo refused ${result.failed} message(s)`);
  }
}
