import type { ReactNode } from "react";
import type { MobileAccessStatus } from "../../../integrations/mobile-access";
import type { MobileAccessMode } from "../../../integrations/mobile-lan";
import type {
  MobilePairingCode,
  MobilePairingStatus,
  MobilePairingTicket,
} from "../../../integrations/mobile-pairing";
import type { RemoteMachine } from "./protocol";

/** A private listener, or the live public tunnel of the Host (only offered when allowed). */
export type PhonePairingMode = MobileAccessMode | "public";

export type PhonePairingCreated = MobilePairingTicket;
export type PhonePairingStatus = MobilePairingStatus;

export type PhonePairingApi = {
  access(machine: RemoteMachine, mode?: PhonePairingMode): Promise<MobileAccessStatus>;
  enable(
    machine: RemoteMachine,
    mode?: MobileAccessMode,
    address?: string,
  ): Promise<MobileAccessStatus>;
  disable?(machine: RemoteMachine, mode?: MobileAccessMode): Promise<MobileAccessStatus>;
  /** `kind` labels the credential the Host issues; Hosts that predate it ignore it. */
  create(machine: RemoteMachine, kind?: "phone" | "desktop"): Promise<PhonePairingCreated>;
  status(machine: RemoteMachine, pairingId: string): Promise<PhonePairingStatus>;
  cancel(machine: RemoteMachine, pairingId: string): Promise<void>;
};

export type PhonePairingError =
  | "connection"
  | "host-update"
  | "invalid-response"
  | "management-required";

export type PhonePairingSession = {
  pairingId: string;
  code: MobilePairingCode;
};

export type PhonePairingState = (
  | { stage: "closed" }
  | {
      stage: "checking" | "enabling" | "creating";
      machine: RemoteMachine;
    }
  | {
      stage: "access";
      machine: RemoteMachine;
      access: MobileAccessStatus;
    }
  | {
      stage: "qr";
      machine: RemoteMachine;
      access: MobileAccessStatus;
      session: PhonePairingSession;
      remainingSeconds: number;
      statusError?: PhonePairingError;
    }
  | {
      stage: "expired";
      machine: RemoteMachine;
      access: MobileAccessStatus;
    }
  | {
      stage: "paired";
      machine: RemoteMachine;
      deviceName?: string;
    }
  | {
      stage: "error";
      machine: RemoteMachine;
      error: PhonePairingError;
    }
) & { mode?: PhonePairingMode };

export type PhoneConnectionPanelProps = {
  machines: RemoteMachine[];
  loaded: boolean;
  loading: boolean;
  onRefresh: () => void | Promise<void>;
  /** Whether the Phone tab is showing. The panel only holds a pairing code while it is. Default true. */
  active?: boolean;
};

export type PhonePairingDialogProps = {
  machines: RemoteMachine[];
  state: Exclude<PhonePairingState, { stage: "closed" }>;
  onSelect: (machine: RemoteMachine) => void;
  onMode?: (mode: PhonePairingMode) => void;
  onClose: () => void;
  onRefresh: () => void;
  onEnable: (address?: string) => void;
  onDisable?: () => void;
  onCreate: () => void;
  onRegenerate: () => void;
};

export type PhonePairingFlowProps = PhonePairingDialogProps & {
  variant: "inline" | "dialog";
  /** Extra option rows, listed under the divider in the inline variant. */
  children?: ReactNode;
};

export type PhonePairingLinkProps = {
  url: string;
  label: string;
};

export type PhonePairingLinkStatus = "idle" | "pending" | "error";

export type PhonePairingCopyProps = {
  code: MobilePairingCode;
};

export type PhonePairingCopyStatus = "idle" | "pending" | "success" | "error";
