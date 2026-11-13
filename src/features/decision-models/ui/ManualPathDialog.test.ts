// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecisionSource, SourceTestResult } from "../model/decisionTypes";
import { ManualPathDialog } from "./ManualPathDialog";
import {
  bodyText,
  clickButton,
  mountDecisionUi,
  settleDecisionUi,
  setInputValue,
  unmountDecisionUi,
} from "./decisionTestDom";

const created: DecisionSource = {
  id: "new",
  name: "Local Clef",
  kind: "local",
  adapter: "systemone",
  endpoint: "http://127.0.0.1:8769/v1/systemone",
  status: "unknown",
};

let mounted: ReturnType<typeof mountDecisionUi> | null = null;

afterEach(() => {
  unmountDecisionUi(mounted);
  mounted = null;
  vi.clearAllMocks();
});

function render(options: {
  prefill?: { name?: string; endpoint?: string };
  testResult?: SourceTestResult;
}) {
  const onAdd = vi.fn(async () => created);
  const onTest = vi.fn(async () => options.testResult ?? { sourceId: "new", ok: true });
  mounted = mountDecisionUi(
    createElement(ManualPathDialog, {
      prefill: options.prefill,
      onAdd,
      onTest,
      onClose: vi.fn(),
    }),
  );
  return { onAdd, onTest };
}

describe("ManualPathDialog", () => {
  it("requires explicit discard before closing an edited source and keeps edits when cancelled", async () => {
    const onClose = vi.fn();
    mounted = mountDecisionUi(
      createElement(ManualPathDialog, {
        onAdd: vi.fn(async () => created),
        onTest: vi.fn(async () => ({ sourceId: "new", ok: true })),
        onClose,
      }),
    );
    const field = mounted.container.ownerDocument.querySelector<HTMLInputElement>("input")!;
    setInputValue(field, "Unsent source");
    clickButton("Cancel");
    await settleDecisionUi();
    expect(bodyText()).toContain("Discard changes?");
    expect(onClose).not.toHaveBeenCalled();
    act(() =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
        .filter((button) => button.textContent === "Cancel")
        .at(-1)!
        .click(),
    );
    await settleDecisionUi();
    expect(field.value).toBe("Unsent source");
    expect(onClose).not.toHaveBeenCalled();
    clickButton("Cancel");
    await settleDecisionUi();
    clickButton("Discard changes");
    await settleDecisionUi();
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("asks for a name and a model file before adding anything", async () => {
    const { onAdd } = render({});
    clickButton("Add and test");
    await settleDecisionUi();
    expect(bodyText()).toContain("Enter a name.");
    expect(bodyText()).toContain("Choose a model file.");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("adds a running address with the chosen contract and reports a passing test", async () => {
    const { onAdd, onTest } = render({
      prefill: { name: "Local Clef", endpoint: "http://127.0.0.1:8769/v1/systemone" },
    });
    clickButton("Add and test");
    await settleDecisionUi();
    expect(onAdd).toHaveBeenCalledWith({
      name: "Local Clef",
      kind: "local",
      adapter: "systemone",
      endpoint: "http://127.0.0.1:8769/v1/systemone",
    });
    expect(onTest).toHaveBeenCalledWith("new");
    expect(bodyText()).toContain("Added. The connection works. Contract: System One.");
  });

  it("keeps the source and names the failed test when the check does not pass", async () => {
    const { onAdd } = render({
      prefill: { name: "Local Clef", endpoint: "http://127.0.0.1:8769/v1/systemone" },
      testResult: { sourceId: "new", ok: false, error: "unavailable" },
    });
    clickButton("Add and test");
    await settleDecisionUi();
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(bodyText()).toContain("Added. The connection test failed: Not available yet.");
  });
});
