// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProviderAccountMenu } from "./ProviderAccountMenu";
import { ModelSourceContext, type ModelSource } from "./modelSource";
import { providerAccounts } from "../../providers/model/providerAccounts";
import { useProviderAccountUsage } from "../../providers/model/accountUsage";

vi.mock("../../providers/model/accountUsage", () => ({
  useProviderAccountUsage: vi.fn(() => ({ usage: {}, now: 0 })),
  accountStatus: vi.fn(),
  accountUsageKey: vi.fn(),
}));
vi.mock("../../providers/model/providerAccounts", async (original) => ({
  ...(await original<typeof import("../../providers/model/providerAccounts")>()),
  providerAccounts: vi.fn(() => [{ id: "native-only", label: "Native only", provider: "codex" }]),
}));

it("renders Host account choices without reading or probing Native credential profiles", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(providerAccounts).mockClear();
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  const selected = vi.fn();
  const source = {
    accounts: {
      codex: [
        { id: "host-a", label: "Host Alpha" },
        { id: "host-b", label: "Host Beta" },
      ],
    },
  } as ModelSource;
  try {
    await act(async () =>
      root.render(
        createElement(
          ModelSourceContext.Provider,
          { value: source },
          createElement(ProviderAccountMenu, {
            provider: "codex",
            accountId: "host-a",
            variant: "notice",
            onSelect: selected,
          }),
        ),
      ),
    );
    await act(async () => element.querySelector<HTMLButtonElement>("button")!.click());
    expect(document.body.textContent).toContain("Host Beta");
    expect(document.body.textContent).not.toContain("Native only");
    expect(providerAccounts).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(useProviderAccountUsage)
        .mock.calls.every(([, options]) => options?.enabled === false),
    ).toBe(true);
    const choice = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(
      (button) => button.textContent?.includes("Host Beta"),
    )!;
    await act(async () => choice.click());
    expect(selected).toHaveBeenCalledWith("host-b");
  } finally {
    await act(async () => root.unmount());
    element.remove();
    vi.unstubAllGlobals();
  }
});
