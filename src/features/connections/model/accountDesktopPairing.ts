import { invoke } from "@tauri-apps/api/core";
import { bytesToBase64Url, type PairRandomBytes } from "../../../integrations/account-pair-crypto";
import {
  MobilePairingCodeError,
  parseMobilePairingCode,
} from "../../../integrations/mobile-pairing";
import type { DesktopPairRequest, DesktopPairTarget } from "../../account";
import type { RemoteMachine } from "./protocol";

/** What the other computer needs to be asked: its account id, Host identity and published https routes. */
export type AccountPairPlan = DesktopPairTarget & {
  name: string;
  routes: string[];
};

export type AccountPairResult =
  | { state: "connected"; machine: RemoteMachine }
  | { state: "denied" | "expired" | "cancelled" }
  | { state: "failed"; reason: "ticket" | "connection" };

export type AccountPairRedeem = (input: {
  name: string;
  environmentId: string;
  routes: string[];
  ticket: string;
  claimId: string;
  deviceName: string;
}) => Promise<RemoteMachine>;

/** Native verifies the Host identity on each route before the one-time ticket leaves this computer. */
export const redeemAccountPair: AccountPairRedeem = (input) =>
  invoke<RemoteMachine>("remote_pair_account", input);

export type AccountPairFlow = {
  code: string;
  expiresAt: string;
  result: Promise<AccountPairResult>;
  cancel: () => void;
};

export type AccountPairDeps = {
  request: (target: DesktopPairTarget) => Promise<DesktopPairRequest>;
  redeem?: AccountPairRedeem;
  /** This computer's display name, shown on the other computer's host as the new device. */
  deviceName: string;
  randomBytes?: PairRandomBytes;
  signal?: AbortSignal;
};

/**
 * One click from the list: ask the account computer, wait for its owner to allow, open the
 * sealed ticket, then redeem it over the published route and save the machine. The ticket must
 * name the same Host the account listed; anything else is dropped before a credential is asked for.
 */
export async function startAccountDesktopPair(
  plan: AccountPairPlan,
  deps: AccountPairDeps,
): Promise<AccountPairFlow> {
  const request = await deps.request({
    deviceId: plan.deviceId,
    environmentId: plan.environmentId,
  });
  const redeem = deps.redeem ?? redeemAccountPair;
  let cancelled = deps.signal?.aborted ?? false;
  const cancel = () => {
    cancelled = true;
    request.cancel();
  };
  deps.signal?.addEventListener("abort", cancel, { once: true });
  if (cancelled) request.cancel();
  async function finish(): Promise<AccountPairResult> {
    const outcome = await request.outcome;
    if (cancelled) return { state: "cancelled" };
    if (outcome.state !== "sealed") return outcome;
    let ticket: string;
    try {
      const code = parseMobilePairingCode(outcome.ticketJson);
      if (code.environmentId !== plan.environmentId) return { state: "failed", reason: "ticket" };
      ticket = code.ticket;
    } catch (error) {
      if (error instanceof MobilePairingCodeError) return { state: "failed", reason: "ticket" };
      throw error;
    }
    const claim = await (
      deps.randomBytes ?? ((size) => crypto.getRandomValues(new Uint8Array(size)))
    )(32);
    if (cancelled) return { state: "cancelled" };
    try {
      const machine = await redeem({
        name: plan.name,
        environmentId: plan.environmentId,
        routes: plan.routes,
        ticket,
        claimId: bytesToBase64Url(claim),
        deviceName: deps.deviceName,
      });
      if (cancelled) return { state: "cancelled" };
      return { state: "connected", machine };
    } catch {
      if (cancelled) return { state: "cancelled" };
      return { state: "failed", reason: "connection" };
    }
  }
  return {
    code: request.code,
    expiresAt: request.expiresAt,
    result: finish()
      .catch((error): AccountPairResult => {
        if (cancelled) return { state: "cancelled" };
        throw error;
      })
      .finally(() => deps.signal?.removeEventListener("abort", cancel)),
    cancel,
  };
}
