import { useSyncExternalStore } from "react";
import { createStoredSetting } from "../../../shared/lib/storedSetting";

/**
 * How a video or audio file on a connected computer reaches the player:
 * `stream` plays at once over the local gateway, `download` copies the whole file first and
 * `saver` transfers nothing until Play or Download is chosen. Shared folders never transfer.
 */
export const REMOTE_MEDIA_MODES = ["stream", "download", "saver"] as const;
export type RemoteMediaMode = (typeof REMOTE_MEDIA_MODES)[number];
export const REMOTE_MEDIA_MODE_DEFAULT: RemoteMediaMode = "stream";
export const REMOTE_MEDIA_MODE_EVENT = "bycoda:remotemediamodechange";

const store = createStoredSetting<RemoteMediaMode>({
  key: "bycoda.remoteMediaMode",
  fallback: REMOTE_MEDIA_MODE_DEFAULT,
  event: REMOTE_MEDIA_MODE_EVENT,
  storageEvents: true,
  parse: (raw) =>
    (REMOTE_MEDIA_MODES as readonly string[]).includes(raw)
      ? (raw as RemoteMediaMode)
      : REMOTE_MEDIA_MODE_DEFAULT,
  serialize: (value) => value,
});

export const loadRemoteMediaMode = store.load;
/** Returns whether the choice was persisted. */
export const saveRemoteMediaMode = store.save;
export const subscribeRemoteMediaMode = store.subscribe;
export const useRemoteMediaMode = () =>
  useSyncExternalStore(
    subscribeRemoteMediaMode,
    loadRemoteMediaMode,
    () => REMOTE_MEDIA_MODE_DEFAULT,
  );
