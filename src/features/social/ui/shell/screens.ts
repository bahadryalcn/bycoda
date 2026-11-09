import type { SocialClient } from "../../model/socialClient";

/** The five redesigned screens, in navigation order. */
export const SOCIAL_SCREEN_IDS = ["command", "content", "audience", "inbox", "accounts"] as const;
export type SocialScreenId = (typeof SOCIAL_SCREEN_IDS)[number];

/** Host-level facts the shell reads once and shares with every screen. Screens never write them. */
export type SocialShellState = {
  /** The Host reports its scheduler as running. */
  hostOnline: boolean;
  /** The last read of this Host failed; the facts above are the last known values. */
  unreachable: boolean;
  /** Global AI stop is on for this Host. */
  aiStopped: boolean;
};

/** The props every redesigned screen receives. Phase 4 screens depend on this shape only. */
export type SocialScreenProps = {
  client: SocialClient;
  machineId: string;
  projectId?: string;
  shellState: SocialShellState;
  /** False while the screen is retained but hidden. Pause polling and timers when false. */
  active: boolean;
  /** The target passed to the last `onNavigate` for this screen, for example a person id. */
  target?: unknown;
  onNavigate(screen: SocialScreenId, target?: unknown): void;
};
