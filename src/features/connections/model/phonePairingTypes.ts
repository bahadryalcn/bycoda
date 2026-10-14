import type { MobileAccessStatus } from "../../../integrations/mobile-access";
import type { MobileAccessMode } from "../../../integrations/mobile-lan";
import type {
  MobilePairingCode,
  MobilePairingStatus,
  MobilePairingTicket,
} from "../../../integrations/mobile-pairing";
import type { RemoteMachine } from "./protocol";

export type PhonePairingCreated = MobilePairingTicket;
export type PhonePairingStatus = MobilePairingStatus;

export type PhonePairingApi = {
  access(machine: RemoteMachine, mode?: MobileAccessMode): Promise<MobileAccessStatus>;
  enable(
    machine: RemoteMachine,
    mode?: MobileAccessMode,
    address?: string,
  ): Promise<MobileAccessStatus>;
  disable?(machine: RemoteMachine): Promise<MobileAccessStatus>;
  create(machine: RemoteMachine): Promise<PhonePairingCreated>;
  status(machine: RemoteMachine, pairingId: string): Promise<PhonePairingStatus>;
  cancel(machine: RemoteMachine, pairingId: string): Promise<void>;
};

export type PhonePairingError = "connection" | "host-update" | "invalid-response";

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
) & { mode?: MobileAccessMode };

export type PhoneConnectionPanelProps = {
  machines: RemoteMachine[];
  loaded: boolean;
  loading: boolean;
  onRefresh: () => void | Promise<void>;
};

export type PhonePairingDialogProps = {
  /** An external tunnel supplies its endpoint; network setup choices do not apply. */
  fixedEndpoint?: boolean;
  machines: RemoteMachine[];
  state: Exclude<PhonePairingState, { stage: "closed" }>;
  onSelect: (machine: RemoteMachine) => void;
  onMode?: (mode: MobileAccessMode) => void;
  onClose: () => void;
  onRefresh: () => void;
  onEnable: (address?: string) => void;
  onDisable?: () => void;
  onCreate: () => void;
  onRegenerate: () => void;
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
