import type { DesktopCommand, DesktopLive } from "./desktopLive";
import type { HostStore } from "../store";

/** A durable offer is consumed before returning its payload. Lost responses stay held. */
export class DesktopCommandDelivery {
  private readonly polling = new Set<string>();

  constructor(
    private readonly live: Pick<
      DesktopLive,
      | "pendingDesktop"
      | "finishDesktopOffer"
      | "desktopAcknowledgement"
      | "finishDesktopAcknowledgement"
    >,
    private readonly store: Pick<HostStore, "offerDesktopCommand" | "ackDesktopCommand">,
  ) {}

  async poll(
    params: Record<string, unknown>,
    authorize: () => Promise<void>,
  ): Promise<DesktopCommand[]> {
    const clientId = typeof params.clientId === "string" ? params.clientId : "legacy";
    const pageToken = typeof params.pageToken === "string" ? params.pageToken : undefined;
    // Do not share one payload with overlapping heartbeat responses or accumulate
    // physical store work when a previous heartbeat's bounded wait has expired.
    if (this.polling.has(clientId)) return [];
    const candidates = this.live.pendingDesktop(clientId);
    const acknowledgements = Array.isArray(params.acked)
      ? [...new Set(params.acked)].flatMap((id) => {
          if (typeof id !== "string") return [];
          const entry = this.live.desktopAcknowledgement(clientId, pageToken, id);
          return entry ? [entry] : [];
        })
      : [];
    if (!candidates.length && !acknowledgements.length) return [];
    this.polling.add(clientId);
    try {
      const commands: DesktopCommand[] = [];
      for (const entry of acknowledgements) {
        // A successful effect can change the current turn. ACK binds the original
        // page/client, not its now-resolved question or running-state fingerprint.
        await this.store.ackDesktopCommand(entry.commandId, entry.ownerId, authorize);
        this.live.finishDesktopAcknowledgement(entry.commandId);
      }
      for (const entry of candidates) {
        const delivery = await this.store.offerDesktopCommand(
          entry.commandId,
          entry.ownerId,
          async () => {
            await authorize();
            await entry.revalidate();
            await authorize();
          },
        );
        this.live.finishDesktopOffer(entry.commandId, delivery !== undefined);
        if (delivery !== undefined) commands.push(JSON.parse(delivery) as DesktopCommand);
      }
      await authorize();
      return commands;
    } finally {
      this.polling.delete(clientId);
    }
  }
}
