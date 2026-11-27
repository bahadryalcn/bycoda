/** `setup-required`: an address is available and the owner can enable the listener.
 * `unavailable`: no address (Tailscale not connected, no network) or a failed bind. */
export type MobileAccessState = "ready" | "setup-required" | "unavailable";

export type MobileAccessStatus = {
  state: MobileAccessState;
  mode?: import("./mobile-lan").MobileAccessMode;
  lanKey?: string;
  addresses?: string[];
  /** Local address to OS interface name, for selecting the phone's network. */
  addressInterfaces?: Record<string, string>;
  endpoint?: string;
  machineName?: string;
  reason?: string;
  /** Advisory network configuration hint; never blocks pairing or readiness. */
  networkHint?: string;
  tls?: import("../shared/model/host-contracts").MobileTlsBootstrap;
};
