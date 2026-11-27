// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression for #1004: the handoff, build and second-opinion buttons must send
// their visible and accessible copy through `t()`, so the active language applies.
const buttonCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("../../../shared/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/i18n")>()),
  useT: () => (key: string) => `T(${key})`,
}));

vi.mock("../../../shared/ui/Button", async () => {
  const { createElement } = await import("react");
  return {
    Button: (props: Record<string, unknown> & { children?: unknown }) => {
      buttonCalls.push(props);
      return createElement(
        "button",
        { type: "button", "aria-label": props["aria-label"] as string },
        props.children as never,
      );
    },
  };
});

vi.mock("../../../integrations/harness/core/availability", () => ({
  getHarnessAvailabilitySnapshot: () => 0,
  hasProbedHarnessAvailability: () => true,
  isHarnessAvailable: () => false,
  probeHarnessAvailability: () => Promise.resolve(),
  subscribeHarnessAvailability: () => () => undefined,
}));

vi.mock("../../../integrations/harness/core/registry", () => ({
  refreshHarnessCatalogs: () => Promise.resolve(),
}));

import { BuildTargetButton, HandoffButton, SecondOpinionButton } from "./SecondOpinionButton";

beforeEach(() => {
  buttonCalls.length = 0;
});

function lastButtonLabel() {
  const props = buttonCalls[buttonCalls.length - 1];
  return props?.["aria-label"];
}

describe("second-opinion button copy (#1004)", () => {
  it("translates the handoff disabled label", () => {
    renderToStaticMarkup(createElement(HandoffButton, { from: "claude", onPick: () => undefined }));

    expect(lastButtonLabel()).toBe("T(Install another provider to hand off)");
  });

  it("translates the build disabled label", () => {
    renderToStaticMarkup(
      createElement(BuildTargetButton, { from: "claude", onPick: () => undefined }),
    );

    expect(lastButtonLabel()).toBe("T(No build providers are available)");
  });

  it("translates the default disabled label when a caller omits every copy prop", () => {
    renderToStaticMarkup(
      createElement(SecondOpinionButton, { from: "claude", onPick: () => undefined }),
    );

    expect(lastButtonLabel()).toBe("T(No different model available for a second opinion)");
  });
});
