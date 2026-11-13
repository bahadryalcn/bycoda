// @vitest-environment happy-dom
import { createElement } from "react";
import { expect, it, vi } from "vitest";
import { EditSourceDialog } from "./EditSourceDialog";
import {
  bodyText,
  clickButton,
  mountDecisionUi,
  setInputValue,
  settleDecisionUi,
  unmountDecisionUi,
} from "./decisionTestDom";

it("explains and preserves an empty model, and saves a typed model", async () => {
  const source = {
    id: "s",
    name: "Local",
    kind: "local",
    adapter: "systemone",
    status: "unknown",
    model: "old",
  } as const;
  const onSave = vi.fn<
    (
      patch: Partial<import("../model/decisionTypes").DecisionSourceInput>,
      apiKey?: string,
    ) => Promise<unknown>
  >(async () => undefined);
  const mounted = mountDecisionUi(
    createElement(EditSourceDialog, { source, onSave, onClose: vi.fn() }),
  );
  try {
    await settleDecisionUi();
    expect(bodyText()).toContain("Leave empty to keep the saved model.");
    expect(bodyText()).not.toContain("Only the name can be changed here.");
    const input = Array.from(document.querySelectorAll<HTMLInputElement>("input")).find(
      (field) => field.value === "old",
    )!;
    setInputValue(input, "");
    clickButton("Save");
    await settleDecisionUi();
    expect(onSave.mock.calls[0][0]).not.toHaveProperty("model");
    setInputValue(input, "new-model");
    clickButton("Save");
    await settleDecisionUi();
    expect(onSave.mock.calls[1][0]).toMatchObject({ model: "new-model" });
  } finally {
    unmountDecisionUi(mounted);
  }
});
