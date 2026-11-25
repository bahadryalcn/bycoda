export type InstagramLiveAction =
  | "open"
  | "status"
  | "capture"
  | "start"
  | "end"
  | "forget"
  | "close";

export type InstagramLiveState = {
  state: "offline" | "producer" | "awaiting_stream" | "live" | "unknown";
  windowOpen: boolean;
  credentialsStored: boolean;
  canStart: boolean;
};
