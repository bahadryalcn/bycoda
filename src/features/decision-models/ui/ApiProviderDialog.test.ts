// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecisionCatalogEntry, DecisionSource } from "../model/decisionTypes";
import { ApiProviderDialog } from "./ApiProviderDialog";
import {
  bodyText,
  clickButton,
  mountDecisionUi,
  setInputValue,
  settleDecisionUi,
  unmountDecisionUi,
} from "./decisionTestDom";

const openRouter: DecisionCatalogEntry = {
  id: "openrouter",
  name: "OpenRouter",
  kind: "gateway",
  adapter: "systemone",
  endpoint: "https://openrouter.ai/api/v1/systemone",
  verified: false,
};

const created: DecisionSource = {
  id: "new",
  name: "OpenRouter",
  kind: "gateway",
  adapter: "systemone",
  status: "unknown",
};

let mounted: ReturnType<typeof mountDecisionUi> | null = null;

afterEach(() => {
  unmountDecisionUi(mounted);
  mounted = null;
  vi.clearAllMocks();
});

describe("ApiProviderDialog", () => {
  it("requires a key, sends it once and does not keep it in the field", async () => {
    const onAdd = vi.fn(async () => created);
    const onTest = vi.fn(async () => ({ sourceId: "new", ok: true }));
    mounted = mountDecisionUi(
      createElement(ApiProviderDialog, {
        catalog: [openRouter],
        catalogError: null,
        onAdd,
        onTest,
        onClose: vi.fn(),
      }),
    );
    await settleDecisionUi();

    clickButton("Add and test");
    await settleDecisionUi();
    expect(bodyText()).toContain("Enter the API key.");
    expect(onAdd).not.toHaveBeenCalled();

    const key = document.querySelector<HTMLInputElement>("input[type='password']");
    if (!key) throw new Error("Key field not found");
    setInputValue(key, "sk-test-value");
    clickButton("Add and test");
    await settleDecisionUi();
    expect(onAdd).toHaveBeenCalledWith(
      {
        name: "OpenRouter",
        kind: "gateway",
        adapter: "systemone",
        endpoint: "https://openrouter.ai/api/v1/systemone",
      },
      "sk-test-value",
    );
    expect(key.value).toBe("");
  });

  it("marks a provider whose details are not verified", async () => {
    mounted = mountDecisionUi(
      createElement(ApiProviderDialog, {
        catalog: [openRouter],
        catalogError: null,
        onAdd: vi.fn(),
        onTest: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    await settleDecisionUi();
    expect(bodyText()).toContain("Not verified");
    expect(bodyText()).toContain("Details for this provider are not verified.");
  });

  it("offers a retry when the provider catalog cannot load", async () => {
    mounted = mountDecisionUi(
      createElement(ApiProviderDialog, {
        catalog: null,
        catalogError: new Error("catalog offline"),
        onAdd: vi.fn(),
        onTest: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    await settleDecisionUi();
    expect(bodyText()).toContain("This did not work. Try again.");
  });
});
