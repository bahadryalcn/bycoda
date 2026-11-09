import type { HostSessionSummary } from "../../src/features/connections/model/protocol";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import { hostWarnDeduped } from "../diagnostics/log-dedupe";
import { sendExpoPush, type ExpoPushMessage } from "./expo-push";
import { detectPushEvents, type PushEvent, type PushSnapshot } from "./push-events";
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
    if (events.length === 0 || this.desktopActive()) return;
    await this.deliver(
      recipients.flatMap((recipient) =>
        events
          .filter((event) => recipient.events[event.kind])
          .slice(0, MAX_PER_TICK)
          .map((event) => this.message(recipient, event)),
      ),
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
