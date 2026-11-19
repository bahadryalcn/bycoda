/** Platforms a live connection can read from. `demo` generates viewers locally for rehearsal. */
export type LivePlatform = "tiktok" | "demo";

/** A viewer as the live platform reports them. `id` is stable per platform; `handle` is the @name. */
export interface LiveViewer {
  id: string;
  handle: string;
  name: string;
  avatarUrl?: string;
}

interface LiveEventBase {
  /** Unique per event; repeated deliveries of the same event keep the same id. */
  id: string;
  at: number;
}

/**
 * One normalized live-stream event. Connectors translate platform messages into this union so the
 * session report, the activity feed and the AI tools never depend on a platform's wire format.
 */
export type LiveEvent =
  | (LiveEventBase & { kind: "comment"; viewer: LiveViewer; text: string })
  | (LiveEventBase & {
      kind: "gift";
      viewer: LiveViewer;
      giftId: number;
      giftName: string;
      /** Diamond value of one gift. */
      diamonds: number;
      /** Gifts counted by this event (a finished streak counts all of them once). */
      count: number;
    })
  | (LiveEventBase & { kind: "like"; viewer: LiveViewer; count: number })
  | (LiveEventBase & { kind: "join"; viewer: LiveViewer })
  | (LiveEventBase & { kind: "follow"; viewer: LiveViewer })
  | (LiveEventBase & { kind: "share"; viewer: LiveViewer })
  | (LiveEventBase & { kind: "viewers"; count: number })
  | (LiveEventBase & { kind: "stream-end" });

export type LiveConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
  | "error";

export interface LiveConnectionState {
  platform: LivePlatform;
  /** The broadcaster's @name without the leading @. */
  channel: string;
  status: LiveConnectionStatus;
  /** Plain-language reason for `offline` and `error`. */
  detail?: string;
  roomId?: string;
  connectedAt?: number;
  attempts: number;
}

/** Strips a leading @, a profile URL and surrounding whitespace from a TikTok username. */
export function normalizeChannel(input: string): string {
  const trimmed = input.trim();
  const fromUrl = /tiktok\.com\/@([^/?#]+)/i.exec(trimmed)?.[1];
  return (fromUrl ?? trimmed).replace(/^@/, "").trim();
}
