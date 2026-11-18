import type { LiveGamesObsSetupOptions } from "../../../shared/model/host-contracts/live-games";

export function overlayLink(base: string, options: LiveGamesObsSetupOptions) {
  try {
    const url = new URL(base);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password)
      return undefined;
    url.searchParams.set("aspect", options.aspect ?? "9:16");
    if (options.clean) url.searchParams.set("clean", "");
    else url.searchParams.delete("clean");
    if (options.mute) url.searchParams.set("mute", "");
    else url.searchParams.delete("mute");
    return url.href;
  } catch {
    return undefined;
  }
}
