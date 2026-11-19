// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { DecisionModelsClient } from "../model/decisionModelsClient";
import { DecisionTarget } from "./DecisionTarget";
import { LocalInstallWizard } from "./LocalInstallWizard";
import { bodyText, mountDecisionUi, settleDecisionUi, unmountDecisionUi } from "./decisionTestDom";

let mounted: ReturnType<typeof mountDecisionUi> | null = null;

afterEach(() => {
  unmountDecisionUi(mounted);
  mounted = null;
});

function pendingClient() {
  const never = () => new Promise<never>(() => undefined);
  return {
    local: { hardware: vi.fn(never), recommend: vi.fn(never), installSupported: vi.fn(never) },
  } as unknown as DecisionModelsClient;
}

function renderWizard(target: string | undefined) {
  mounted = mountDecisionUi(
    createElement(
      DecisionTarget.Provider,
      { value: target },
      createElement(LocalInstallWizard, {
        client: pendingClient(),
        catalog: [],
        onChooseApi: vi.fn(),
        onInstalled: vi.fn(),
        onClose: vi.fn(),
      }),
    ),
  );
}

it("names the Host in the hardware check progress for a remote target", async () => {
  renderWizard("Remote A");
  await settleDecisionUi();
  expect(bodyText()).toContain("Checking Host Remote A…");
  expect(bodyText()).not.toContain("Checking this computer…");
});

it("names this computer in the hardware check progress without a target", async () => {
  renderWizard(undefined);
  await settleDecisionUi();
  expect(bodyText()).toContain("Checking this computer…");
});
