// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecisionSource, SourceTestResult } from "../model/decisionTypes";
import { SourceRow } from "./SourceRow";
import { mountDecisionUi, settleDecisionUi, unmountDecisionUi } from "./decisionTestDom";

const FAKE_ENDPOINT = "https://fake-provider.invalid/v1/decide";
const FAKE_SECRET = "sk-fake-0000000000";

function fakeSource(overrides: Partial<DecisionSource> = {}): DecisionSource {
  return {
    id: "fake-source",
    name: "Fake provider",
    kind: "api",
    adapter: "systemone",
    endpoint: FAKE_ENDPOINT,
    status: "unknown",
    ...overrides,
  };
}

let mounted: ReturnType<typeof mountDecisionUi> | null = null;

afterEach(() => {
  unmountDecisionUi(mounted);
  mounted = null;
  vi.clearAllMocks();
});

function renderRow(source: DecisionSource, testResult?: SourceTestResult) {
  const actions = { testSource: vi.fn() } as unknown as Parameters<typeof SourceRow>[0]["actions"];
  mounted = mountDecisionUi(
    createElement(
      "ul",
      null,
      createElement(SourceRow, {
        source,
        testResult,
        actions,
        isPending: () => false,
        onEdit: vi.fn(),
        onRemove: vi.fn(),
      }),
    ),
  );
}

function alertText(): string | null {
  return document.querySelector('[role="alert"]')?.textContent ?? null;
}

describe("SourceRow test failure feedback", () => {
  it("shows an actionable reason inline for a failed test without hover or the menu", () => {
    renderRow(fakeSource(), { sourceId: "fake-source", ok: false, error: "unavailable" });
    expect(alertText()).toContain("Connection test failed. Check your credentials and retry.");
    expect(mounted!.container.textContent).toContain("Failed");
  });

  it("never prints the endpoint or a key in the failure line", () => {
    renderRow(fakeSource(), { sourceId: "fake-source", ok: false, error: "unavailable" });
    expect(alertText()).not.toContain(FAKE_ENDPOINT);
    expect(alertText()).not.toContain(FAKE_SECRET);
    expect(alertText()).not.toContain("fake-provider");
  });

  it("explains a below-threshold failure in plain words", () => {
    renderRow(fakeSource(), { sourceId: "fake-source", ok: false, error: "below_threshold" });
    expect(alertText()).toContain("Confidence is below the threshold.");
  });

  it("does not claim a credentials problem for a local source", () => {
    renderRow(fakeSource({ kind: "local", endpoint: "http://127.0.0.1:8769/v1/fake" }), {
      sourceId: "fake-source",
      ok: false,
      error: "unavailable",
    });
    expect(alertText()).toContain("Not available yet.");
    expect(alertText()).not.toContain("credentials");
  });

  it("adds no line after a passing test or for a stored error without a test result", () => {
    renderRow(fakeSource(), { sourceId: "fake-source", ok: true });
    expect(alertText()).toBeNull();
    unmountDecisionUi(mounted);
    renderRow(fakeSource({ status: "error" }));
    expect(alertText()).toBeNull();
    expect(mounted!.container.textContent).toContain("Failed");
  });

  it("labels the details toggle with its state", async () => {
    renderRow(fakeSource());
    const openMenu = () =>
      act(() =>
        document.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')!.click(),
      );
    const toggle = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((node) =>
        /details$/.test(node.textContent?.trim() ?? ""),
      );
    openMenu();
    await settleDecisionUi();
    expect(toggle()?.textContent).toContain("Show details");
    act(() => toggle()!.click());
    await settleDecisionUi();
    openMenu();
    await settleDecisionUi();
    expect(toggle()?.textContent).toContain("Hide details");
  });
});
