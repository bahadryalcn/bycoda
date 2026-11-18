import {
  ControlEvent,
  SignConfig,
  TikTokLiveConnection,
  WebcastEvent,
} from "tiktok-live-connector";
import type { LiveEvent } from "../../../src/features/live-games/model/liveEvents";
import { mapTikTokEvent } from "./tiktok-map";

const events = [
  WebcastEvent.CHAT,
  WebcastEvent.GIFT,
  WebcastEvent.LIKE,
  WebcastEvent.MEMBER,
  WebcastEvent.FOLLOW,
  WebcastEvent.SHARE,
  WebcastEvent.ROOM_USER,
  WebcastEvent.STREAM_END,
] as const;

type TikTokCookieJar = TikTokLiveConnection["webClient"]["cookieJar"];

/** Signing and gallery routes may read the jar without a destination. Keep those calls anonymous. */
export function restrictTikTokCookies(jar: TikTokCookieJar): void {
  const getGuestCookies = jar.getAnonymousCookieString.bind(jar);
  jar.getCookieString = async (destination = "") => {
    const target = URL.parse(destination);
    return target?.protocol === "https:" && /(?:^|\.)tiktokv?\.com$/i.test(target.hostname)
      ? getGuestCookies()
      : "";
  };
  jar.getSessionBundle = async () => null;
}

export function tiktokConnectionError(error: unknown): { detail: string; offline: boolean } {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (
    /useroffline|live has ended|not currently live|not live|room.*offline/i.test(
      `${name} ${message}`,
    )
  )
    return { offline: true, detail: "This channel is offline. Waiting for its live stream." };
  if (/ratelimit|rate.limit|429/i.test(`${name} ${message}`))
    return {
      offline: false,
      detail: "The TikTok signing service is rate-limiting requests. Retrying shortly.",
    };
  return {
    offline: false,
    detail: "Could not read TikTok LIVE. Check the channel name and connection. Retrying shortly.",
  };
}

export function connectTikTok(
  channel: string,
  key: string | undefined,
  callbacks: {
    event: (event: LiveEvent) => void;
    connected: (roomId: string) => void;
    disconnected: (error?: unknown) => void;
  },
) {
  // Only an Euler API key can be supplied. Never supply TikTok account credentials.
  if (SignConfig.basePath !== "https://api.eulerstream.com" || SignConfig.apiKey !== key) {
    SignConfig.basePath = "https://api.eulerstream.com";
    SignConfig.apiKey = key;
    SignConfig.cachedInstance = undefined;
  }
  const client = new TikTokLiveConnection(channel, {
    processInitialData: false,
    fetchRoomInfoOnConnect: true,
    enableExtendedGiftInfo: true,
  });
  restrictTikTokCookies(client.webClient.cookieJar);
  let closed = false;
  const deadline = setTimeout(() => fail(new Error("TikTok connection timed out")), 20_000);
  deadline.unref();
  function close() {
    closed = true;
    clearTimeout(deadline);
    try {
      client.disconnect();
    } catch {
      /* Opening may still be in progress. */
    }
  }
  function fail(error?: unknown) {
    if (closed) return;
    close();
    callbacks.disconnected(error);
  }
  client.on(ControlEvent.ERROR, fail);
  client.on(ControlEvent.DISCONNECTED, () => fail());
  for (const name of events) {
    client.on(name, (payload: unknown) => {
      if (closed) return;
      const event = mapTikTokEvent(name, payload, Date.now());
      if (event) callbacks.event(event);
      if (event?.kind === "stream-end") fail(new Error("The live has ended."));
    });
  }
  void client
    .connect()
    .then((state) => {
      if (closed) {
        close();
        return;
      }
      clearTimeout(deadline);
      callbacks.connected(String(state.roomId));
    }, fail)
    .catch(fail);
  return close;
}
