import { PhonePairingFlow } from "../../../src/features/connections/ui/PhonePairingFlow";
import type { PhonePairingFlowProps } from "../../../src/features/connections/model/phonePairingTypes";

const machine = {
  id: "fixture-phone",
  name: "Fixture computer",
  endpoint: "https://pairing.example.invalid",
  environmentId: "fixture-environment",
};
const state: PhonePairingFlowProps["state"] = {
  stage: "qr",
  machine,
  access: { state: "ready", endpoint: machine.endpoint },
  remainingSeconds: 120,
  session: {
    pairingId: "fixture-pairing",
    code: {
      kind: "bycoda.mobile-pairing",
      version: 1,
      endpoint: machine.endpoint,
      environmentId: machine.environmentId,
      name: machine.name,
      ticket: "fixture-not-a-live-ticket",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  },
};

/** Actual QR consumer with inert synthetic data; no access grant or pairing request. */
export function PhonePairingFixture() {
  return (
    <main style={{ maxWidth: 480, margin: "64px auto", padding: 24 }}>
      <PhonePairingFlow
        variant="inline"
        fixedEndpoint
        machines={[machine]}
        state={state}
        onSelect={() => {}}
        onClose={() => {}}
        onRefresh={() => {}}
        onEnable={() => {}}
        onCreate={() => {}}
        onRegenerate={() => {}}
      />
    </main>
  );
}
