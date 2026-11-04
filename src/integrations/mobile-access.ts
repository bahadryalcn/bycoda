export type MobileAccessState =
  | "ready"
  | "setup-required"
  | "install-required"
  | "sign-in-required"
  | "offline"
  | "approval-required"
  | "permission-required"
  | "unavailable";

export type MobileAccessStatus = {
  state: MobileAccessState;
  mode?: import("./mobile-lan").MobileAccessMode;
  lanKey?: string;
  addresses?: string[];
  endpoint?: string;
  machineName?: string;
  reason?: string;
  approvalUrl?: string;
  tls?: import("../shared/model/host-contracts").MobileTlsBootstrap;
};
