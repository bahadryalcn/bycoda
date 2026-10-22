import { phonePairingCode, phonePairingError } from "./phonePairingContract";
import type { RemoteMachine } from "./protocol";
import type { PhonePairingApi, PhonePairingState } from "./phonePairingTypes";
import type { MobileAccessMode } from "../../../integrations/mobile-lan";

const CLOSED: PhonePairingState = { stage: "closed" };

/** A pairing flow owns a short-lived ticket and releases it with its target. */
export class PhonePairingCoordinator {
  private state: PhonePairingState = CLOSED;
  private generation = 0;
  private listeners = new Set<() => void>();
  private pollId: string | undefined;
  private mode: MobileAccessMode = "lan";

  constructor(
    private readonly api: PhonePairingApi,
    private readonly now: () => number = Date.now,
  ) {}

  getSnapshot = (): PhonePairingState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(state: PhonePairingState): void {
    this.state = state.stage === "closed" ? state : { ...state, mode: this.mode };
    for (const listener of this.listeners) listener();
  }

  private release(state: PhonePairingState): void {
    if (state.stage === "qr") {
      void this.api.cancel(state.machine, state.session.pairingId).catch(() => {});
    }
  }

  close = (): void => {
    const previous = this.state;
    this.generation++;
    this.publish(CLOSED);
    this.release(previous);
  };

  open = async (machine: RemoteMachine, mode: MobileAccessMode = this.mode): Promise<void> => {
    this.mode = mode;
    const previous = this.state;
    const generation = ++this.generation;
    this.publish({ stage: "checking", machine });
    this.release(previous);
    try {
      const access = await this.api.access(machine, mode);
      if (generation !== this.generation) return;
      this.publish({ stage: "access", machine, access });
    } catch (error) {
      if (generation !== this.generation) return;
      this.publish({
        stage: "error",
        machine,
        error: phonePairingError(error),
      });
    }
  };

  selectMode = async (mode: MobileAccessMode): Promise<void> => {
    if (this.state.stage !== "closed") await this.open(this.state.machine, mode);
  };

  disable = async (): Promise<void> => {
    const state = this.state;
    if (
      state.stage === "closed" ||
      ["checking", "creating", "enabling"].includes(state.stage) ||
      this.mode !== "lan" ||
      !this.api.disable
    )
      return;
    const generation = ++this.generation;
    this.release(state);
    this.publish({ stage: "checking", machine: state.machine });
    try {
      const access = await this.api.disable(state.machine);
      if (generation === this.generation)
        this.publish({ stage: "access", machine: state.machine, access });
    } catch (error) {
      if (generation === this.generation)
        this.publish({ stage: "error", machine: state.machine, error: phonePairingError(error) });
    }
  };

  refresh = async (): Promise<void> => {
    const state = this.state;
    if (
      state.stage === "closed" ||
      state.stage === "checking" ||
      state.stage === "enabling" ||
      state.stage === "creating"
    )
      return;
    await this.open(state.machine);
  };

  regenerate = async (): Promise<void> => {
    const state = this.state;
    if (state.stage !== "qr" && state.stage !== "expired") return;
    const generation = this.generation + 1;
    await this.open(state.machine);
    if (generation === this.generation) await this.create();
  };

  enable = async (address?: string): Promise<void> => {
    const state = this.state;
    if (
      state.stage !== "access" ||
      !["setup-required", "permission-required"].includes(state.access.state)
    )
      return;
    const generation = this.generation;
    this.publish({ stage: "enabling", machine: state.machine });
    try {
      const access = await this.api.enable(state.machine, this.mode, address);
      if (generation !== this.generation) return;
      this.publish({ stage: "access", machine: state.machine, access });
      if (access.state === "ready") await this.create();
    } catch (error) {
      if (generation !== this.generation) return;
      this.publish({
        stage: "error",
        machine: state.machine,
        error: phonePairingError(error),
      });
    }
  };

  create = async (): Promise<void> => {
    const state = this.state;
    if ((state.stage !== "access" && state.stage !== "expired") || state.access.state !== "ready")
      return;
    const generation = this.generation;
    this.publish({ stage: "creating", machine: state.machine });
    let pairingId: string | undefined;
    try {
      const created = await this.api.create(state.machine);
      pairingId = created.pairingId;
      if (generation !== this.generation) {
        await this.api.cancel(state.machine, created.pairingId).catch(() => {});
        return;
      }
      const code = phonePairingCode(state.machine, state.access, created);
      this.publish({
        stage: "qr",
        machine: state.machine,
        access: state.access,
        session: { pairingId: created.pairingId, code },
        remainingSeconds: Math.max(0, Math.ceil((Date.parse(code.expiresAt) - this.now()) / 1_000)),
      });
    } catch (error) {
      if (pairingId) {
        void this.api.cancel(state.machine, pairingId).catch(() => {});
      }
      if (generation !== this.generation) return;
      this.publish({
        stage: "error",
        machine: state.machine,
        error: phonePairingError(error),
      });
    }
  };

  tick = (): void => {
    const state = this.state;
    if (state.stage !== "qr") return;
    const remainingSeconds = Math.max(
      0,
      Math.ceil((Date.parse(state.session.code.expiresAt) - this.now()) / 1_000),
    );
    if (!remainingSeconds) {
      this.publish({
        stage: "expired",
        machine: state.machine,
        access: state.access,
      });
      this.release(state);
    } else if (remainingSeconds !== state.remainingSeconds) {
      this.publish({ ...state, remainingSeconds });
    }
  };

  check = async (): Promise<void> => {
    this.tick();
    const state = this.state;
    if (state.stage !== "qr" || this.pollId === state.session.pairingId) return;
    const pairingId = state.session.pairingId;
    const generation = this.generation;
    this.pollId = pairingId;
    try {
      const status = await this.api.status(state.machine, pairingId);
      const current = this.state;
      if (
        generation !== this.generation ||
        current.stage !== "qr" ||
        current.session.pairingId !== pairingId
      )
        return;
      if (status.state === "paired") {
        this.publish({
          stage: "paired",
          machine: state.machine,
          deviceName: status.deviceName,
        });
      } else if (status.state === "expired" || status.state === "cancelled") {
        this.publish({
          stage: "expired",
          machine: state.machine,
          access: state.access,
        });
      } else if (current.statusError) {
        this.publish({ ...current, statusError: undefined });
      }
    } catch (error) {
      const current = this.state;
      if (
        generation === this.generation &&
        current.stage === "qr" &&
        current.session.pairingId === pairingId
      )
        this.publish({ ...current, statusError: phonePairingError(error) });
    } finally {
      if (this.pollId === pairingId) this.pollId = undefined;
    }
  };
}
