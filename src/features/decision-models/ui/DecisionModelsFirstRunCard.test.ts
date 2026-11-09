// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecisionModelsClient } from "../model/decisionModelsClient";
import type { LocalRecommendation } from "../model/decisionTypes";
import { DecisionModelsFirstRunCard } from "./DecisionModelsFirstRunCard";
import {
  bodyText,
  clickButton,
  mountDecisionUi,
  settleDecisionUi,
  unmountDecisionUi,
} from "./decisionTestDom";

let mounted: ReturnType<typeof mountDecisionUi> | null = null;

afterEach(() => {
  unmountDecisionUi(mounted);
  mounted = null;
  vi.clearAllMocks();
});

function clientWith(recommend: () => Promise<LocalRecommendation>) {
  return { local: { recommend: vi.fn(recommend) } } as unknown as DecisionModelsClient;
}

describe("DecisionModelsFirstRunCard", () => {
  it("suggests the API path on an insufficient machine and respects Not now", async () => {
    const onDismiss = vi.fn();
    const client = clientWith(async () => ({ tier: "insufficient" }));
    mounted = mountDecisionUi(
      createElement(DecisionModelsFirstRunCard, {
        client,
        onDismiss,
        onOpenSettings: vi.fn(),
      }),
    );
    await settleDecisionUi();
    expect(bodyText()).toContain("Set up a decision model?");
    expect(bodyText()).toContain("An API provider is recommended.");
    clickButton("Not now");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("offers a local model when this computer can run one", async () => {
    const client = clientWith(async () => ({ tier: "strong", modelId: "clef-flash-9b" }));
    mounted = mountDecisionUi(
      createElement(DecisionModelsFirstRunCard, {
        client,
        onDismiss: vi.fn(),
        onOpenSettings: vi.fn(),
      }),
    );
    await settleDecisionUi();
    expect(bodyText()).toContain("Set up a local decision model?");
  });

  it("stays silent when the recommendation cannot be read", async () => {
    const client = clientWith(async () => {
      throw new Error("unavailable");
    });
    mounted = mountDecisionUi(
      createElement(DecisionModelsFirstRunCard, {
        client,
        onDismiss: vi.fn(),
        onOpenSettings: vi.fn(),
      }),
    );
    await settleDecisionUi();
    expect(bodyText()).not.toContain("Set up");
  });
});
