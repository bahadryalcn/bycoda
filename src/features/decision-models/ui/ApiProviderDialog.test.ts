// @vitest-environment happy-dom
import { act, createElement } from "react";
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

vi.mock("../../../shared/ui/Select", () => ({
  Select: ({
    value,
    options,
    onValueChange,
  }: {
    value: string;
    options: { value: string; label: string }[];
    onValueChange: (value: string) => void;
  }) =>
    createElement(
      "select",
      {
        "aria-label": "Provider",
        value,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
          onValueChange(event.target.value),
      },
      options.map((option) =>
        createElement("option", { key: option.value, value: option.value }, option.label),
      ),
    ),
}));

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
    const onRetry = vi.fn();
    mounted = mountDecisionUi(
      createElement(ApiProviderDialog, {
        catalog: null,
        catalogError: new Error("catalog offline"),
        onRetryCatalog: onRetry,
        onAdd: vi.fn(),
        onTest: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    await settleDecisionUi();
    expect(bodyText()).toContain("This did not work. Try again.");
    clickButton("Try again");
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

it("selects a late catalog preselection without treating it as an edit", async () => {
  const onClose = vi.fn();
  const props = {
    catalog: null as DecisionCatalogEntry[] | null,
    catalogError: null,
    preselectId: "openrouter",
    onAdd: vi.fn(),
    onTest: vi.fn(),
    onClose,
  };
  mounted = mountDecisionUi(createElement(ApiProviderDialog, props));
  await act(async () =>
    mounted!.root.render(createElement(ApiProviderDialog, { ...props, catalog: [openRouter] })),
  );
  await settleDecisionUi();
  expect(document.querySelector<HTMLSelectElement>('select[aria-label="Provider"]')?.value).toBe(
    "openrouter",
  );
  clickButton("Cancel");
  expect(onClose).toHaveBeenCalledOnce();
});

it("retains a chosen provider, model and key when the catalog refreshes", async () => {
  const second = { ...openRouter, id: "second", name: "Second" };
  const props = {
    catalog: null as DecisionCatalogEntry[] | null,
    catalogError: null,
    onAdd: vi.fn(),
    onTest: vi.fn(),
    onClose: vi.fn(),
  };
  mounted = mountDecisionUi(createElement(ApiProviderDialog, props));
  await act(async () =>
    mounted!.root.render(
      createElement(ApiProviderDialog, { ...props, catalog: [openRouter, second] }),
    ),
  );
  const select = document.querySelector<HTMLSelectElement>('select[aria-label="Provider"]')!;
  expect(select.value).toBe("openrouter");
  act(() => {
    select.value = "second";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const key = document.querySelector<HTMLInputElement>('input[type="password"]')!;
  const model = Array.from(document.querySelectorAll<HTMLInputElement>("input")).find(
    (input) => input !== key,
  )!;
  setInputValue(key, "test-key");
  setInputValue(model, "test-model");
  await act(async () =>
    mounted!.root.render(
      createElement(ApiProviderDialog, { ...props, catalog: [{ ...openRouter }, { ...second }] }),
    ),
  );
  expect(select.value).toBe("second");
  expect(key.value).toBe("test-key");
  expect(model.value).toBe("test-model");
});
