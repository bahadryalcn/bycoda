import { widgetPushPayload, widgetPushIdentity } from "./widget-payload";
import type { HostSessionSummary } from "../../src/features/connections/model/protocol";
import type { AssistantNotification } from "../../src/shared/model/host-contracts/assistant";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import { hostWarnDeduped } from "../diagnostics/log-dedupe";
import {
  ExpoPushError,
  sendExpoPush,
  type ExpoPushMessage,
  type ExpoPushResult,
} from "./expo-push";
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
import {
  SOCIAL_PUSH_MAX_AGE_MS,
  socialPushAllowed,
  socialPushMessage,
  type SocialPushLedger,
  type SocialPushSource,
} from "./push-social";
import type { ApprovalRegistry } from "../approvals/approval-registry";
import type { PushDeviceStore, PushRecipient } from "./push-store";

/** A desktop window counts as in use for this long after its last active report. */
export const DESKTOP_PRESENCE_MS = 20_000;
const POLL_MS = 4_000;
/** At most this many pushes reach one phone per tick; the rest wait for later ticks. */
const MAX_PER_TICK = 3;
/** Events one phone is still owed beyond its per-tick cap; past this, the oldest are dropped with a warning. */
const MAX_BACKLOG = 30;
/** A push Expo could not take is retried for this long, then dropped with a warning. */
const RETRY_TTL_MS = 15 * 60_000;
/** After an unreachable Expo, sends pause for this long, doubling per consecutive failure up to the cap. */
const EXPO_BACKOFF_BASE_MS = 30_000;
const EXPO_BACKOFF_CAP_MS = 10 * 60_000;
/** An Assistant tick's read of pending items and phones is reused for sends until it is this old, then re-read. */
const ASSISTANT_RECHECK_MS = 1_000;

/** An event owed to a phone; `failedSince` is set once Expo has refused it, which starts its retry window. */
type QueuedEvent = PushEvent & { failedSince?: number };

/** Pending Assistant items and phones as read at `readAt`, keyed for lookup by id and device hash. */
type AssistantView = {
  readAt: number;
  pending: Map<string, AssistantNotification>;
  phones: Map<string, PushRecipient>;
};

/** First occurrence of each kind + session, so a session re-reported while queued is sent once. */
function uniqueEvents<T extends PushEvent>(events: T[]): T[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.kind}:${event.sessionId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function retainNewest(events: QueuedEvent[]): QueuedEvent[] {
  if (events.length <= MAX_BACKLOG) return events;
  hostWarnDeduped(
    `Push notifications: ${events.length - MAX_BACKLOG} queued event(s) dropped; a phone's backlog is full.`,
  );
  return events.slice(-MAX_BACKLOG);
}

type Dependencies = {
  store: PushDeviceStore;
  environmentId: string;
  /** Every top-level conversation on this Host, desktop-owned ones included. */
  sessions: () => Promise<HostSessionSummary[]>;
  /** Pending Assistant notifications with the Host's own delivery verdicts; absent disables that channel. */
  assistant?: AssistantPushSource;
  assistantLedger?: AssistantPushLedger;
  /** Social items that wait for the owner (requests, NEEDS_HUMAN, expired sign-ins); absent disables that channel. */
  social?: SocialPushSource;
  socialLedger?: SocialPushLedger;
  /** Native-authorized configured Telegram channel; runs even when no phone is paired. */
  telegram?: () => Promise<void>;
  /** Remote-answerable owner approvals; absent disables that channel. */
  approvals?: ApprovalRegistry;
  send?: typeof sendExpoPush;
  now?: () => number;
  /** Durable notification timestamps use wall time, never the desktop heartbeat clock. */
  wallNow?: () => number;
  pollMs?: number;
  /** Releases what `sessions` listens to when the service stops. */
  onStop?: () => void;
};

/**
 * Sends conversation events while the desktop is away. Assistant reports use
 * their independent phone settings, including while the desktop is active.
 */
export class PushNotifications {
  private snapshot: PushSnapshot | undefined;
  private widgetIdentity = "";
  private widgetSentAt = 0;
  private presence = new Map<string, number>();
  /** Events waiting for a phone's later ticks, keyed by the phone's device hash. Memory only. */
  private backlog = new Map<string, QueuedEvent[]>();
  /** Phones an approval push already reached, so a retry for another phone never repeats it. Memory only. */
  private approvalDelivery = new Map<string, { since: number; done: Set<string> }>();
  /** Last owned-event set and the recipient fingerprint it was computed under. Memory only. */
  private ownedCache: { key: string; kinds: PushEventKind[] } | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  /** Expo is shared by every phone, so its outage backoff is global; the per-phone state above is unchanged. */
  private expoFailures = 0;
  private expoRetryAt: number | undefined;
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
    this.deps.onStop?.();
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
    try {
      await this.deps.telegram?.();
    } catch {
      hostWarnDeduped("Assistant Telegram delivery is unavailable; mobile push remains active.");
    }
    const recipients = await this.deps.store.recipients();
    if (recipients.length === 0) {
      // Nobody to notify: skip the list read, and start from a fresh baseline later.
      this.snapshot = undefined;
      this.widgetIdentity = "";
      this.backlog.clear();
      this.approvalDelivery.clear();
      return;
    }
    const widgetRecipients = recipients.filter(
      (r) => r.widgetUpdates === true && (r.events.finished || r.events.input || r.events.failed),
    );
    const away = !this.desktopActive();
    if (!away && widgetRecipients.length === 0) {
      // Nothing needs the session list: conversation pushes are suppressed while the desktop is in use and
      // no widget wants an update. Skip the read; the next away tick starts from a fresh baseline, so
      // transitions the desktop's user already saw are not owed later.
      this.snapshot = undefined;
      this.backlog.clear();
      await this.channel("Assistant", () => this.tickAssistant(recipients));
      return;
    }
    const sessions = await this.deps.sessions();
    const widget = widgetPushPayload(sessions, (this.deps.wallNow ?? Date.now)());
    const widgetIdentity = `${widgetPushIdentity(widget)}:${JSON.stringify(widgetRecipients.map((r) => [r.deviceHash, r.pushToken]).sort())}`;
    if (widgetIdentity !== this.widgetIdentity || widget.at - this.widgetSentAt >= 4 * 60_000) {
      // Data-only delivery reaches headless tasks. Existing registration and event consent gates apply.
      const messages = widgetRecipients.map((r): ExpoPushMessage => ({
        to: r.pushToken,
        data: {
          kind: "widget",
          environmentId: this.deps.environmentId,
          widget: JSON.stringify(widget),
        },
        priority: "high",
        _contentAvailable: true,
        collapseId: `bycoda-widget-${this.deps.environmentId}`,
        ttl: 600,
      }));
      try {
        // A throttled phone or a failed request leaves the identity uncommitted, so the next tick sends the
        // widget again. Replay is safe here: the message is data-only and its collapseId replaces a duplicate.
        if ((await this.deliver(messages)).length === 0) {
          this.widgetIdentity = widgetIdentity;
          this.widgetSentAt = widget.at;
        }
      } catch {
        hostWarnDeduped("Widget push delivery unavailable; session notifications remain active.");
      }
    }
    const { events, next } = detectPushEvents(this.snapshot, sessions);
    this.snapshot = next;
    // Events seen while the desktop is in use were seen by its user; they are not owed later.
    if (away) await this.channel("Session", () => this.deliverEvents(recipients, events));
    else this.backlog.clear();
    await this.channel("Assistant", () => this.tickAssistant(recipients));
    if (away) {
      await this.channel("Approval", () => this.tickApprovals(recipients));
      await this.channel("Social", () => this.tickSocial(recipients));
    }
  }

  /** One channel's failure is logged and never skips the channels after it. */
  private async channel(name: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      hostWarnDeduped(
        `Push notifications: ${name} delivery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Each phone gets at most MAX_PER_TICK events per tick. The rest wait in that phone's bounded backlog
   * and go out on later ticks. Preferences are checked on every send, so a turned-off kind stops here.
   */
  private async deliverEvents(recipients: PushRecipient[], events: PushEvent[]): Promise<void> {
    const now = this.now();
    // Rebuilt from the current recipients, so a removed phone's backlog is dropped with it.
    const plan = recipients.map((recipient) => {
      const owed = (this.backlog.get(recipient.deviceHash) ?? []).filter((event) => {
        const fresh =
          event.failedSince === undefined || elapsedSince(event.failedSince, now) <= RETRY_TTL_MS;
        if (!fresh)
          hostWarnDeduped(
            "Push notifications: a push Expo could not take was dropped after retrying.",
          );
        return fresh;
      });
      const queue = uniqueEvents<QueuedEvent>(
        [...owed, ...events].filter((event) => recipient.events[event.kind]),
      );
      return {
        recipient,
        sending: queue.slice(0, MAX_PER_TICK),
        waiting: queue.slice(MAX_PER_TICK),
      };
    });
    this.backlog.clear();
    for (const { recipient, waiting } of plan)
      if (waiting.length > 0) this.backlog.set(recipient.deviceHash, retainNewest(waiting));
    const entries = plan.flatMap(({ recipient, sending }) =>
      sending.map((event) => ({ recipient, event, message: this.message(recipient, event) })),
    );
    // Only what Expo certainly did not take returns to the queue (throttled, never sent): accepted or
    // unknown-outcome pushes are never sent twice, and the retry window starts at the first refusal.
    const unsent = new Set(await this.attempt(entries.map((entry) => entry.message)));
    for (const { recipient } of plan) {
      const refused = entries
        .filter((entry) => entry.recipient === recipient && unsent.has(entry.message))
        .map(({ event }): QueuedEvent => ({ ...event, failedSince: event.failedSince ?? now }));
      if (refused.length === 0) continue;
      const waiting = this.backlog.get(recipient.deviceHash) ?? [];
      this.backlog.set(recipient.deviceHash, retainNewest(uniqueEvents([...refused, ...waiting])));
    }
  }

  /**
   * A Social item that waits while nobody uses the desktop reaches each phone that wants "needs your
   * input" once. The claim is written before sending and kept unless Expo certainly did not take the
   * push; an unknown outcome is never replayed.
   */
  private async tickSocial(recipients: PushRecipient[]): Promise<void> {
    const { social, socialLedger: ledger } = this.deps;
    const interested = recipients.filter(socialPushAllowed);
    if (!social || !ledger || interested.length === 0) return;
    const wall = (this.deps.wallNow ?? Date.now)();
    const waiting = (await social()).filter((item) => wall - item.at <= SOCIAL_PUSH_MAX_AGE_MS);
    const claimed: { recipient: PushRecipient; id: string; message: ExpoPushMessage }[] = [];
    for (const recipient of interested) {
      let sent = 0;
      for (const item of waiting) {
        if (sent >= MAX_PER_TICK) break;
        if (await ledger.sent(recipient.deviceHash, item.id)) continue;
        if (!(await ledger.claim(recipient.deviceHash, item.id, wall))) continue;
        claimed.push({
          recipient,
          id: item.id,
          message: socialPushMessage(recipient, item, this.deps.environmentId),
        });
        sent++;
      }
    }
    // A claim whose push Expo certainly did not take is released, so a later tick sends it; the item's
    // own age limit ends the retries.
    const unsent = new Set(await this.attempt(claimed.map((entry) => entry.message)));
    for (const entry of claimed)
      if (unsent.has(entry.message)) await ledger.release(entry.recipient.deviceHash, entry.id);
  }

  /**
   * An approval that waits while nobody uses the desktop reaches each interested phone once. The message
   * carries no operation text; the phone opens the approval and reads the full summary from the Host.
   */
  private async tickApprovals(recipients: PushRecipient[]): Promise<void> {
    const registry = this.deps.approvals;
    if (!registry) return;
    const unpushed = registry.unpushed();
    // A resolved or expired approval no longer needs its delivery record.
    const live = new Set(unpushed.map((item) => item.id));
    for (const id of this.approvalDelivery.keys())
      if (!live.has(id)) this.approvalDelivery.delete(id);
    // Only the first few go out this tick; the rest stay unpushed and are picked up by later ticks.
    const waiting = unpushed.slice(0, MAX_PER_TICK);
    if (waiting.length === 0) return;
    const now = this.now();
    const interested = recipients.filter((recipient) => recipient.events.approvals);
    const entries = waiting.flatMap((item) => {
      const state = this.approvalDelivery.get(item.id) ?? { since: now, done: new Set<string>() };
      this.approvalDelivery.set(item.id, state);
      return interested
        .filter((recipient) => !state.done.has(recipient.deviceHash))
        .map((recipient) => ({
          item,
          recipient,
          message: {
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
          } satisfies ExpoPushMessage,
        }));
    });
    const unsent = new Set(await this.attempt(entries.map((entry) => entry.message)));
    for (const { item, recipient, message } of entries)
      if (!unsent.has(message)) this.approvalDelivery.get(item.id)?.done.add(recipient.deviceHash);
    // Marked pushed once every interested phone is settled (accepted or unknown outcome, which is never
    // replayed) or after the retry window; until then a certainly refused phone is retried alone.
    for (const item of waiting) {
      const state = this.approvalDelivery.get(item.id);
      if (!state) continue;
      const owed = interested.some((recipient) => !state.done.has(recipient.deviceHash));
      if (owed && elapsedSince(state.since, now) <= RETRY_TTL_MS) continue;
      if (owed) hostWarnDeduped("Push notifications: an approval push was dropped after retrying.");
      registry.markPushed(item.id);
      this.approvalDelivery.delete(item.id);
    }
  }

  /**
   * Phones receive their configured Assistant channel independently of desktop
   * activity. Urgent reminders stop on acknowledgement.
   */
  private async tickAssistant(recipients: PushRecipient[]): Promise<void> {
    const { assistant, assistantLedger: ledger } = this.deps;
    if (!assistant || !ledger || !recipients.some((recipient) => recipient.events.assistant))
      return;
    // One read of the pending items and the phones per tick; each send re-verifies against it.
    let view = await this.readAssistantView(assistant);
    const sends: { deviceHash: string; id: string }[] = [];
    for (const phone of view.phones.values()) {
      if (!phone.events.assistant) continue;
      for (const item of view.pending.values()) {
        if (assistantPushAllowed(item, phone))
          sends.push({ deviceHash: phone.deviceHash, id: item.id });
      }
    }
    if (sends.length === 0) return;
    // One receipt per occurrence: a partial or unknown Expo result never permits a restart replay.
    for (const send of sends) {
      // Unsent reminders stay pending (no reservation) and go out on a later tick once Expo is back.
      if (!this.expoOpen()) break;
      // A fresh read only once the view is old, so an acknowledgement or a removed phone stops the send within the recheck age.
      if (elapsedSince(view.readAt, this.now()) > ASSISTANT_RECHECK_MS)
        view = await this.readAssistantView(assistant);
      const current = view.pending.get(send.id);
      const recipient = view.phones.get(send.deviceHash);
      if (!current || !recipient || !assistantPushAllowed(current, recipient)) continue;
      const occurrence = await ledger.reserve(
        recipient.deviceHash,
        current,
        (this.deps.wallNow ?? Date.now)(),
      );
      if (occurrence === null) continue;
      let result: ExpoPushResult;
      try {
        result = await this.send([
          assistantPushMessage(recipient, current, this.deps.environmentId),
        ]);
      } catch (error) {
        // The outcome is unknown, so the reservation stays fenced (no replay); other reminders go on.
        if (error instanceof ExpoPushError) {
          await this.settle(error.partial);
          if (error.unreachable) this.recordExpo(false);
        }
        hostWarnDeduped(
          "Assistant push delivery was not confirmed; reminder is retained without replay.",
        );
        continue;
      }
      this.recordExpo(true);
      for (const token of result.unregistered) await this.deps.store.forgetToken(token);
      if (result.failed === 0 && result.unregistered.length === 0)
        await ledger.accept(send.deviceHash, send.id, occurrence);
      else
        hostWarnDeduped(
          "Assistant push delivery was not confirmed; reminder is retained without replay.",
        );
    }
  }

  /** One Assistant profile read and one recipient read; their timestamp starts the recheck age. */
  private async readAssistantView(assistant: AssistantPushSource): Promise<AssistantView> {
    const [pending, phones] = await Promise.all([assistant(), this.deps.store.recipients()]);
    return {
      readAt: this.now(),
      pending: new Map(pending.map((item) => [item.id, item])),
      phones: new Map(phones.map((phone) => [phone.deviceHash, phone])),
    };
  }

  /**
   * The event kinds at least one registered phone receives from this Host. The desktop leaves those
   * to the Host instead of also reporting them to the account, which would push the same phone twice.
   */
  async ownedEvents(): Promise<PushEventKind[]> {
    // Read the fingerprint before the rows: a change in between leaves a stale key, so the next beat recomputes.
    const key = await this.deps.store.recipientsFingerprint();
    if (this.ownedCache?.key === key) return this.ownedCache.kinds;
    const recipients = await this.deps.store.recipients();
    const kinds = PUSH_EVENT_KINDS.filter((kind) =>
      recipients.some((recipient) => recipient.events[kind]),
    );
    this.ownedCache = { key, kinds };
    return kinds;
  }

  /** Sends a sample to the calling phone, bypassing presence and event choices. */
  async test(deviceHash: string, body: string): Promise<boolean> {
    const [recipient] = await this.deps.store.recipients(deviceHash);
    if (!recipient || !this.expoOpen()) return false;
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

  /**
   * Sends, forgets dead tokens and returns the messages Expo did not take that may be sent again. Throws on a refused request.
   * While Expo is in outage backoff nothing is sent and every message is returned as still owed.
   */
  private async deliver(messages: ExpoPushMessage[]): Promise<ExpoPushMessage[]> {
    if (messages.length === 0) return [];
    if (!this.expoOpen()) return messages;
    let result: ExpoPushResult;
    try {
      result = await this.send(messages);
    } catch (error) {
      // Earlier batches of this request were accepted; their dead tokens are still forgotten.
      if (error instanceof ExpoPushError) {
        await this.settle(error.partial);
        if (error.unreachable) this.recordExpo(false);
      }
      throw error;
    }
    this.recordExpo(true);
    await this.settle(result);
    return result.retry ?? [];
  }

  /** False while an unreachable Expo is in backoff; sends are skipped and their messages stay owed. */
  private expoOpen(): boolean {
    return this.expoRetryAt === undefined || this.now() >= this.expoRetryAt;
  }

  /** Starts a backoff after an unreachable Expo, doubling per consecutive failure; any success resets it. */
  private recordExpo(reachable: boolean): void {
    if (reachable) {
      this.expoFailures = 0;
      this.expoRetryAt = undefined;
      return;
    }
    this.expoFailures++;
    const delay = Math.min(
      EXPO_BACKOFF_CAP_MS,
      EXPO_BACKOFF_BASE_MS * 2 ** (this.expoFailures - 1),
    );
    this.expoRetryAt = this.now() + delay;
    hostWarnDeduped("Push notifications: Expo is unreachable; sends pause with backoff.");
  }

  private async settle(result: ExpoPushResult): Promise<void> {
    // One failed store write must not keep the other dead tokens of this result: a token left behind is reported again by Expo.
    for (const token of result.unregistered)
      await this.deps.store
        .forgetToken(token)
        .catch(() =>
          hostWarnDeduped("Push notifications: a dead push token could not be forgotten."),
        );
    if (result.failed > 0)
      hostWarnDeduped(`Push notifications: Expo refused ${result.failed} message(s)`);
  }

  /**
   * Like `deliver`, but a failed request never throws: it returns only the messages Expo certainly did
   * not take (explicit throttle, batches never sent). An unexpected error from the sender has an unknown
   * outcome, so it returns nothing and the messages are never replayed.
   */
  private async attempt(messages: ExpoPushMessage[]): Promise<ExpoPushMessage[]> {
    try {
      return await this.deliver(messages);
    } catch (error) {
      hostWarnDeduped(
        `Push notifications: ${error instanceof Error ? error.message : String(error)}`,
      );
      return error instanceof ExpoPushError ? (error.partial.retry ?? []) : [];
    }
  }
}
